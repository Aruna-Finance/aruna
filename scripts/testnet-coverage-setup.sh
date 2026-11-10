#!/usr/bin/env bash
# Deploys the coverage stack to testnet under ARUNA_TESTNET_ACCOUNT (plan U9, KTD1). The v0 stack
# (registry, factory, demo2) is left as it is.
#   registry2.<you>     registry v2: classes, attestors, drift reports, freezes, disputes
#   factory2.<you>      creates vaults (the current version, res/aruna_vault.wasm) by global hash, with no key
#   pool.<you>          the pool, one book per token
#   usdc.<you>          a TEST NEP-141 token (six decimals, no value), minted by <you>
#   drift-owner.<you>   publishes the drift target BY ACCOUNT; its redeploy is the change in the demo
#   drift-target.<you>  runs drift-owner's code; the covered target
#   attestor-a.<you>, attestor-b.<you>   two bonded attestors (both Aruna's, stated openly)
#   demo3.factory2.<you>  vault v3, owned by demo-client.<you>, operated by demo-company.<you>
#
#   ARUNA_TESTNET_ACCOUNT=you.testnet bash scripts/testnet-coverage-setup.sh
#
# Testnet only. About 70 NEAR for a first run: the vault v3 publish (about 28.6 NEAR) and the drift
# target's publish by account (about 12 NEAR, and again on every redeploy) are spent; the rest is
# account balances, bonds and pool capital. <you> is the registry owner, the arbiter, the classifier
# and the underwriter. Idempotent: existing accounts are left as they are.
set -euo pipefail
cd "$(dirname "$0")/.."

P="${ARUNA_TESTNET_ACCOUNT:?set ARUNA_TESTNET_ACCOUNT to a funded testnet account}"
case "$P" in *.testnet) ;; *) echo "refusing: $P is not a .testnet account" >&2; exit 1 ;; esac
PSIGN="${ARUNA_PARENT_SIGN:-sign-with-keychain}"
NET=(network-config testnet)

REGISTRY="registry2.$P"; FACTORY="factory2.$P"; POOL="pool.$P"; USDC="usdc.$P"
DOWNER="drift-owner.$P"; TARGET="drift-target.$P"; AA="attestor-a.$P"; AB="attestor-b.$P"
CLIENT="demo-client.$P"; COMPANY="demo-company.$P"; VAULT="demo3.$FACTORY"
VAULT_WASM=contracts/vault/res/aruna_vault.wasm
VAULT_HASH=$(node fixtures/tools.mjs hash "$VAULT_WASM")
ATTESTOR="node packages/attestor/dist/index.js"

step() { printf '\n== %s\n' "$*"; }
exists() { node fixtures/tools.mjs exists "$1"; }
create() { # account, balance
  if exists "$1"; then echo "$1 exists"; return 1; fi
  near account create-account fund-myself "$1" "$2" autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$P" "${NET[@]}" "$PSIGN" send
}
call() { # contract, method, json, deposit, signer, sign-method [gas]
  near contract call-function as-transaction "$1" "$2" json-args "$3" prepaid-gas "${7:-100 Tgas}" attached-deposit "$4" \
    sign-as "$5" "${NET[@]}" "$6" send
}
pcall() { call "$1" "$2" "$3" "$4" "$P" "$PSIGN" "${5:-100 Tgas}"; }
deploy() { # account, wasm, init json
  near contract deploy "$1" use-file "$2" with-init-call new json-args "$3" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' "${NET[@]}" sign-with-legacy-keychain send
}

pnpm --filter @aruna/classifier-core --filter @aruna/rpc --filter @aruna/cli --filter @aruna/attestor build >/dev/null

step "$REGISTRY, $FACTORY, $POOL; vault v3 by global hash $VAULT_HASH"
if create "$REGISTRY" "3.5 NEAR"; then
  deploy "$REGISTRY" contracts/registry/res/aruna_registry.wasm "{\"owner\":\"$P\"}"
  pcall "$REGISTRY" add_classifier "{\"account\":\"$P\"}" '0 NEAR'
fi
if create "$FACTORY" "2 NEAR"; then
  near contract deploy-as-global use-file "$VAULT_WASM" as-global-hash "$P" "${NET[@]}" "$PSIGN" send
  deploy "$FACTORY" contracts/factory/res/aruna_factory.wasm "{\"owner\":\"$P\",\"registry\":\"$REGISTRY\",\"vault_code_hash\":\"$VAULT_HASH\"}"
  pcall "$REGISTRY" set_factory "{\"factory\":\"$FACTORY\"}" '0 NEAR'
  pcall "$REGISTRY" allow_vault_code_hash "{\"code_hash\":\"$VAULT_HASH\",\"allowed\":true}" '0 NEAR'
fi
if create "$POOL" "3.5 NEAR"; then
  deploy "$POOL" contracts/pool/res/aruna_pool.wasm "{\"owner\":\"$P\",\"registry\":\"$REGISTRY\"}"
  pcall "$REGISTRY" set_pool "{\"pool\":\"$POOL\"}" '0 NEAR'
fi

step "$USDC (test token, no value)"
if create "$USDC" "2.2 NEAR"; then
  deploy "$USDC" fixtures/wasm/usdc/usdc.wasm "{\"owner\":\"$P\"}"
fi

step "$DOWNER publishes the drift target v1 by account; $TARGET runs it"
if create "$DOWNER" "25 NEAR"; then
  near contract deploy-as-global use-file fixtures/wasm/drift-target/v1/drift_target.wasm as-global-account-id "$DOWNER" "${NET[@]}" sign-with-legacy-keychain send
fi
if create "$TARGET" "1 NEAR"; then
  near contract deploy "$TARGET" use-global-account-id "$DOWNER" without-init-call "${NET[@]}" sign-with-legacy-keychain send
fi

step "classify $TARGET into $REGISTRY"
pcall "$REGISTRY" set_class "$(node fixtures/tools.mjs class-args "$TARGET")" '0 NEAR'

step "attestors $AA and $AB, bonded; $AA assigned to $TARGET"
for A in "$AA" "$AB"; do
  if create "$A" "1.6 NEAR"; then
    KEY=$($ATTESTOR keygen --attestor "$A")
    call "$REGISTRY" register_attestor "{\"signing_key\":\"$KEY\"}" '1 NEAR' "$A" sign-with-legacy-keychain
  fi
done
pcall "$REGISTRY" assign_attestor "{\"target\":\"$TARGET\",\"attestor\":\"$AA\"}" '0 NEAR'

step "vault $VAULT, created by the company for the client"
create "$CLIENT" "0.5 NEAR" || true
create "$COMPANY" "1.5 NEAR" || true
NEW_VAULT=0
if exists "$VAULT"; then echo "$VAULT exists"; else
  NEW_VAULT=1
  near tokens "$P" send-near "$COMPANY" '2.5 NEAR' "${NET[@]}" "$PSIGN" send
  near tokens "$P" send-near "$CLIENT" '1 NEAR' "${NET[@]}" "$PSIGN" send
  CEILING='{"tokens":[{"token":"near","max_per_tx":"500000000000000000000000","daily_total":"2000000000000000000000000"},{"token":{"ft":"'"$USDC"'"},"max_per_tx":"10000000","daily_total":"40000000"}],"max_risk_class":"global_by_account","allowed_targets":["'"$TARGET"'"],"agent_allowance":"1000000000000000000000000"}'
  call "$FACTORY" create_vault "{\"name\":\"demo3\",\"owner\":\"$CLIENT\",\"operator\":\"$COMPANY\",\"ceiling\":$CEILING}" \
    '2 NEAR' "$COMPANY" sign-with-legacy-keychain '150 Tgas'
fi

if [ "$NEW_VAULT" = 1 ]; then
step "test USDC: storage for every account that holds it, then mint"
for A in "$VAULT" "$POOL" "$CLIENT" "$P" "$TARGET"; do
  pcall "$USDC" storage_deposit "{\"account_id\":\"$A\"}" '0.0125 NEAR'
done
pcall "$USDC" mint "{\"account_id\":\"$P\",\"amount\":\"1000000000\"}" '0 NEAR'
pcall "$USDC" mint "{\"account_id\":\"$CLIENT\",\"amount\":\"50000000\"}" '0 NEAR'
pcall "$USDC" mint "{\"account_id\":\"$VAULT\",\"amount\":\"20000000\"}" '0 NEAR'

step "underwriting: $P deposits NEAR and test USDC into $POOL"
pcall "$POOL" deposit '{}' '2 NEAR'
pcall "$USDC" ft_transfer_call "{\"receiver_id\":\"$POOL\",\"amount\":\"500000000\",\"msg\":\"{\\\"action\\\":\\\"deposit\\\"}\"}" '1 yoctoNEAR' '100 Tgas'
fi

step "classify the vault with Aruna's own classifier"
node packages/cli/dist/index.js classify "$VAULT" --network testnet
