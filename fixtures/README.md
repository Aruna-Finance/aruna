# Fixtures — one testnet account per risk class

Real accounts anyone can paste into the classifier page or the CLI. They all run the same
151-byte contract (`contracts/versioned`, one view method `version()`, whose only import is
`value_return`), so each class comes from how the code is referenced and which keys the account
holds, never from the code itself.

| Account | Class | Basis | How |
|---|---|---|---|
| `fx-imm.arunafi.testnet` | `immutable_verified` | `no_detected_path` | global contract **by hash**, one function-call key, full-access key deleted |
| `fx-upg.arunafi.testnet` | `local_upgradeable` | `full_access_key` | local code, full-access key kept |
| `fx-guser.arunafi.testnet` | `global_by_account` | `global_owner` | executes whatever `fx-gowner.arunafi.testnet` publishes **by account id** |
| `fx-nocode.arunafi.testnet` | `unknown` | `undetermined` | no code at all |

Check any of them yourself:

```bash
pnpm --filter @aruna/cli build
node packages/cli/dist/index.js classify fx-imm.arunafi.testnet --network testnet
```

Expected: `"class": "immutable_verified"`. `fx-guser` shows `monitoredCodeHash`
`11111111111111111111111111111111` next to a real `resolvedCodeHash`: the field most monitoring
watches says "no code" while code runs.

## Files

| Path | What |
|---|---|
| `wasm/v1/versioned.wasm` | v1 build, code hash `8ijWM1kfo9EdYWpRJfsa7HKsx3zAWkXTVr3tHsA9CEoW`. Committed, because the accounts use these exact bytes |
| `wasm/v2/versioned.wasm` | v2 build (`--features v2`), code hash `6ptQjUdp6CHh7crhRVTDoSwFJ2inLHESt4q4b8FcxdeA`, for the drift demo |
| `snapshots/*.json` | what the RpcReader returned for each account; `packages/classifier-core/test/fixtures.test.ts` replays them offline |
| `deploy.sh` | creates the accounts under your own testnet account and records the snapshots |
| `tools.mjs` | code hash, throwaway public key, full-access key lookup. Never touches a private key |

## Deploy your own copy

Needs `near-cli-rs` ≥ 0.31 and a funded testnet account whose key is in the near-cli-rs keychain
(about 3 NEAR is used). Testnet only: the script refuses any account not ending in `.testnet`.

```bash
pnpm install && pnpm --filter @aruna/rpc build
ARUNA_TESTNET_ACCOUNT=you.testnet bash fixtures/deploy.sh
```

Each new account's key is saved by near-cli-rs to `~/.near-credentials/testnet/`, outside the repo.
Rebuild the contract with `(cd fixtures/contracts/versioned && cargo near build non-reproducible-wasm --no-abi)`;
a different toolchain may produce different bytes, and so a different hash.
