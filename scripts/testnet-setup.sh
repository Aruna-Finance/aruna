#!/usr/bin/env bash
# Deploys Aruna's v0 contracts to testnet under ARUNA_TESTNET_ACCOUNT and creates one demo vault:
#   registry.<you>   classifier set, class records, vault versions
#   factory.<you>    creates vaults by global hash, with no key
#   vault code       published once as a global contract by hash (about 19 NEAR, spent)
#   demo-client.<you> / demo-company.<you>   the client (owner) and the AaaS company (operator)
#   demo.factory.<you>   the demo vault
#
#   ARUNA_TESTNET_ACCOUNT=you.testnet bash scripts/testnet-setup.sh
#
# Testnet only. About 26 NEAR in total. The parent signs from the near-cli-rs keychain
# (ARUNA_PARENT_SIGN to override); new accounts' keys go to ~/.near-credentials, never the repo.
# Idempotent: existing accounts are left as they are.
set -euo pipefail
cd "$(dirname "$0")/.."

PARENT="${ARUNA_TESTNET_ACCOUNT:?set ARUNA_TESTNET_ACCOUNT to a funded testnet account}"
case "$PARENT" in *.testnet) ;; *) echo "refusing: $PARENT is not a .testnet account" >&2; exit 1 ;; esac
PARENT_SIGN="${ARUNA_PARENT_SIGN:-sign-with-keychain}"
NET=(network-config testnet)

REGISTRY="registry.$PARENT"
FACTORY="factory.$PARENT"
CLIENT="demo-client.$PARENT"
COMPANY="demo-company.$PARENT"
VAULT="demo.$FACTORY"
VAULT_WASM=contracts/vault/res/aruna_vault.wasm
VAULT_HASH=$(node fixtures/tools.mjs hash "$VAULT_WASM")

step() { printf '\n== %s\n' "$*"; }
exists() { node fixtures/tools.mjs exists "$1"; }
create() { # account, balance
  if exists "$1"; then echo "$1 exists"; return 1; fi
  near account create-account fund-myself "$1" "$2" autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$PARENT" "${NET[@]}" "$PARENT_SIGN" send
}
call() { # contract, method, json, deposit, signer, sign-method
  near contract call-function as-transaction "$1" "$2" json-args "$3" prepaid-gas '150 Tgas' attached-deposit "$4" \
    sign-as "$5" "${NET[@]}" "$6" send
}

step "vault code by global hash $VAULT_HASH"
near contract deploy-as-global use-file "$VAULT_WASM" as-global-hash "$PARENT" "${NET[@]}" "$PARENT_SIGN" send

step "$REGISTRY"
if create "$REGISTRY" "2.5 NEAR"; then
  near contract deploy "$REGISTRY" use-file contracts/registry/res/aruna_registry.wasm with-init-call new \
    json-args "{\"owner\":\"$PARENT\"}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' "${NET[@]}" sign-with-legacy-keychain send
  call "$REGISTRY" add_classifier "{\"account\":\"$PARENT\"}" '0 NEAR' "$PARENT" "$PARENT_SIGN"
fi

step "$FACTORY"
if create "$FACTORY" "2.5 NEAR"; then
  near contract deploy "$FACTORY" use-file contracts/factory/res/aruna_factory.wasm with-init-call new \
    json-args "{\"owner\":\"$PARENT\",\"registry\":\"$REGISTRY\",\"vault_code_hash\":\"$VAULT_HASH\"}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' "${NET[@]}" sign-with-legacy-keychain send
  call "$REGISTRY" set_factory "{\"factory\":\"$FACTORY\"}" '0 NEAR' "$PARENT" "$PARENT_SIGN"
fi

step "client and company"
create "$CLIENT" "0.5 NEAR" || true
create "$COMPANY" "1.5 NEAR" || true

step "$VAULT, created by the company for the client"
if exists "$VAULT"; then echo "$VAULT exists"; else
  CEILING='{"max_per_tx":"1000000000000000000000000","daily_total":"3000000000000000000000000","max_risk_class":"local_upgradeable","allowed_targets":["fx-imm.'"$PARENT"'"],"agent_allowance":"250000000000000000000000"}'
  call "$FACTORY" create_vault "{\"name\":\"demo\",\"owner\":\"$CLIENT\",\"operator\":\"$COMPANY\",\"ceiling\":$CEILING}" \
    '1 NEAR' "$COMPANY" sign-with-legacy-keychain
fi

step "classify the vault with Aruna's own classifier"
node packages/cli/dist/index.js classify "$VAULT" --network testnet
