#!/usr/bin/env bash
# Deploys one testnet account per risk class under ARUNA_TESTNET_ACCOUNT, then records snapshots.
# Testnet only (CLAUDE.md rule 3). Keys never enter the repo: the parent signs from the near-cli-rs
# keychain, and each fixture account's key is saved to the legacy keychain (~/.near-credentials).
#
#   ARUNA_TESTNET_ACCOUNT=you.testnet bash fixtures/deploy.sh
#
# Optional: ARUNA_PARENT_SIGN=sign-with-legacy-keychain if your parent key is in ~/.near-credentials.
# Idempotent: accounts that already exist are left as they are.
set -euo pipefail
cd "$(dirname "$0")"

PARENT="${ARUNA_TESTNET_ACCOUNT:?set ARUNA_TESTNET_ACCOUNT to a funded testnet account you can sign for}"
case "$PARENT" in
  *.testnet) ;;
  *) echo "refusing: $PARENT is not a .testnet account (fixtures are testnet only)" >&2; exit 1 ;;
esac
PARENT_SIGN="${ARUNA_PARENT_SIGN:-sign-with-keychain}"
NET=(network-config testnet)

V1=wasm/v1/versioned.wasm
V2=wasm/v2/versioned.wasm
V1_HASH=$(node tools.mjs hash "$V1")

IMM="fx-imm.$PARENT"        # immutable_verified: global by hash, function-call key only
UPG="fx-upg.$PARENT"        # local_upgradeable:  local code, full-access key kept
OWNER="fx-gowner.$PARENT"   # publishes the global contract by account id
USER="fx-guser.$PARENT"     # global_by_account:  executes whatever OWNER publishes
NOCODE="fx-nocode.$PARENT"  # unknown:            an account with no code

step() { printf '\n== %s\n' "$*"; }
exists() { node tools.mjs exists "$1"; }

create() { # account, initial balance
  if exists "$1"; then echo "$1 exists, skipping creation"; return; fi
  near account create-account fund-myself "$1" "$2" autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$PARENT" "${NET[@]}" "$PARENT_SIGN" send
}

step "global contract v1 by hash ($V1_HASH), signed by $PARENT"
near contract deploy-as-global use-file "$V1" as-global-hash "$PARENT" "${NET[@]}" "$PARENT_SIGN" send

step "$IMM — by hash, one function-call key, no full-access key"
if exists "$IMM" && [ -z "$(node tools.mjs full-access-keys "$IMM")" ]; then
  echo "$IMM already locked, skipping"
else
  create "$IMM" "0.5 NEAR"
  near contract deploy "$IMM" use-global-hash "$V1_HASH" without-init-call "${NET[@]}" sign-with-legacy-keychain send
  # A function-call key nobody holds: it only shows that function-call keys do not disqualify.
  near account add-key "$IMM" grant-function-call-access --allowance '0.1 NEAR' --contract-account-id "$IMM" \
    --function-names version use-manually-provided-public-key "$(node tools.mjs random-pk)" "${NET[@]}" sign-with-legacy-keychain send
  # Last: delete the full-access key. After this nobody can change the account's code or keys.
  near account delete-keys "$IMM" public-keys "$(node tools.mjs full-access-keys "$IMM")" "${NET[@]}" sign-with-legacy-keychain send
fi

step "$UPG — local code, full-access key kept"
if exists "$UPG"; then echo "$UPG exists, skipping"; else
  create "$UPG" "0.5 NEAR"
  near contract deploy "$UPG" use-file "$V1" without-init-call "${NET[@]}" sign-with-legacy-keychain send
fi

step "$OWNER publishes v1 by account id; $USER uses it"
if exists "$USER"; then echo "$USER exists, skipping"; else
  create "$OWNER" "1 NEAR"
  near contract deploy-as-global use-file "$V1" as-global-account-id "$OWNER" "${NET[@]}" sign-with-legacy-keychain send
  create "$USER" "0.5 NEAR"
  near contract deploy "$USER" use-global-account-id "$OWNER" without-init-call "${NET[@]}" sign-with-legacy-keychain send
fi

step "$NOCODE — no code"
create "$NOCODE" "0.1 NEAR"

step "snapshots"
node snapshot.mjs "$IMM" "$UPG" "$USER" "$NOCODE"
echo "done. v2 for the drift demo: $V2"
