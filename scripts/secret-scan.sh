#!/usr/bin/env bash
# Fails if tracked or staged files look like they contain a NEAR private key or a seed phrase.
# Usage: scripts/secret-scan.sh            scan files tracked by git (working tree)
#        scripts/secret-scan.sh --history  also scan every commit in history
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# ed25519/secp256k1 secret keys are base58 strings of 64+ chars after the curve prefix.
KEY_RE='(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{80,}'
# A private_key / secret_key / seed_phrase field with a non-empty value.
FIELD_RE='"?(private_key|secret_key|seed_phrase|master_seed_phrase)"?[[:space:]]*[:=][[:space:]]*"[^"]{8,}'

status=0
if git grep -nIE "$KEY_RE|$FIELD_RE" -- ':!scripts/secret-scan.sh' ':!pnpm-lock.yaml'; then
  echo "secret-scan: possible secret in tracked files" >&2
  status=1
fi
if [[ "${1:-}" == "--history" ]]; then
  if git log -p --all | grep -nIE "$KEY_RE|$FIELD_RE" | grep -v 'secret-scan.sh' ; then
    echo "secret-scan: possible secret in git history" >&2
    status=1
  fi
fi
[[ $status -eq 0 ]] && echo "secret-scan: clean"
exit $status
