#!/usr/bin/env bash
# Deploys Aruna's v0 contracts to testnet under ARUNA_TESTNET_ACCOUNT and creates one demo vault:
#   registry.<you>   classifier set, class records, vault versions
#   factory.<you>    creates vaults by global hash, with no key
#   vault code       published once as a global contract by hash (about 19 NEAR, spent)
#   demo-client.<you> / demo-company.<you>   the client (owner) and the AaaS company (operator)
#   swap.<you>           the swap fixture, the vault's one adapter target (classified into the registry)
#   <name>.factory.<you> the demo vault, ARUNA_VAULT_NAME (default demo)
#
#   ARUNA_TESTNET_ACCOUNT=you.testnet bash scripts/testnet-setup.sh
#
# The v0 stack runs vault v2 (res/aruna_vault-v2.wasm); vault v3 runs on the coverage stack
# (scripts/testnet-coverage-setup.sh). A new v0 vault version: point VAULT_WASM at it and run with a new
# ARUNA_VAULT_NAME. The script publishes the new code (about 0.0001 NEAR per byte, spent), points the
# factory at it, and creates a vault that runs it. Existing vaults keep their code forever.
#
# Testnet only. About 35 NEAR for a first run, about 27 for a new version. The parent signs from the near-cli-rs keychain
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
SWAP="swap.$PARENT"
VAULT="${ARUNA_VAULT_NAME:-demo}.$FACTORY"
VAULT_WASM=contracts/vault/res/aruna_vault-v2.wasm
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
CURRENT=$(exists "$FACTORY" && node fixtures/tools.mjs view "$FACTORY" get_config | node -pe 'JSON.parse(require("fs").readFileSync(0)).vault_code_hash' || true)
if [ "$CURRENT" = "$VAULT_HASH" ]; then echo "published, and the factory already uses it"; else
  near contract deploy-as-global use-file "$VAULT_WASM" as-global-hash "$PARENT" "${NET[@]}" "$PARENT_SIGN" send
fi

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
elif [ "$CURRENT" != "$VAULT_HASH" ]; then
  call "$FACTORY" set_vault_code_hash "{\"vault_code_hash\":\"$VAULT_HASH\"}" '0 NEAR' "$PARENT" "$PARENT_SIGN"
fi

step "$SWAP, classified into the registry by $PARENT"
if create "$SWAP" "1.5 NEAR"; then
  near contract deploy "$SWAP" use-file fixtures/wasm/swap/swap.wasm without-init-call "${NET[@]}" sign-with-legacy-keychain send
fi
call "$REGISTRY" set_class "$(node fixtures/tools.mjs class-args "$SWAP")" '0 NEAR' "$PARENT" "$PARENT_SIGN"

step "client and company"
create "$CLIENT" "0.5 NEAR" || true
create "$COMPANY" "1.5 NEAR" || true

step "$VAULT, created by the company for the client"
if exists "$VAULT"; then echo "$VAULT exists"; else
  near tokens "$PARENT" send-near "$COMPANY" '3 NEAR' "${NET[@]}" "$PARENT_SIGN" send
  CEILING='{"max_per_tx":"1000000000000000000000000","daily_total":"3000000000000000000000000","max_risk_class":"local_upgradeable","allowed_targets":["'"$SWAP"'"],"agent_allowance":"1000000000000000000000000"}'
  call "$FACTORY" create_vault "{\"name\":\"${VAULT%%.*}\",\"owner\":\"$CLIENT\",\"operator\":\"$COMPANY\",\"ceiling\":$CEILING}" \
    '3 NEAR' "$COMPANY" sign-with-legacy-keychain
fi

step "classify the vault with Aruna's own classifier"
node packages/cli/dist/index.js classify "$VAULT" --network testnet
