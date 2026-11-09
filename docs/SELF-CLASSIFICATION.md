# Aruna's vault, classified by Aruna's own classifier

A vault created by the factory on testnet, read with the same engine that classifies any NEAR
account. Re-run it yourself:

```bash
pnpm install && pnpm -r build
node packages/cli/dist/index.js classify demo.factory.arunafi.testnet --network testnet
```

Expected: `"class": "immutable_verified"`, `"mutabilityBasis": "no_detected_path"`,
`"fullAccessKeyCount": 0`, `"upgradeImports": []`.

## What was deployed (10 November 2026, testnet)

| Account | Role |
|---|---|
| `registry.arunafi.testnet` | classifier set and vault versions; owner `arunafi.testnet` |
| `factory.arunafi.testnet` | creates vaults by global hash, adds no key |
| `demo-client.arunafi.testnet` | the client: owner of the vault |
| `demo-company.arunafi.testnet` | the agent-as-a-service company: operator |
| `demo.factory.arunafi.testnet` | the vault, created by `demo-company` for `demo-client` |

The vault code was published once as a global contract by hash,
`5s1ggttSbdcSxSCjRyxqKmWUC7sCR6MLB26z7eMLhPhq`, from `contracts/vault/res/aruna_vault.wasm`
(fee 19.163 NEAR). The registry records the vault with that code hash and `demo-client` as owner.
The operator then added one agent key; the vault added it to itself.

## The evidence, as read

```json
{
  "class": "immutable_verified",
  "evidence": {
    "accountId": "demo.factory.arunafi.testnet",
    "checkedAtBlock": 276952782,
    "codeRef": {
      "kind": "global_hash",
      "globalHash": "5s1ggttSbdcSxSCjRyxqKmWUC7sCR6MLB26z7eMLhPhq"
    },
    "fullAccessKeyCount": 0,
    "functionCallKeyCount": 1,
    "monitoredCodeHash": "11111111111111111111111111111111",
    "resolvedCodeHash": "5s1ggttSbdcSxSCjRyxqKmWUC7sCR6MLB26z7eMLhPhq",
    "upgradeImports": [],
    "mutabilityBasis": "no_detected_path",
    "wasmParsed": true
  }
}
```

- **By hash:** `codeRef.kind` is `global_hash`. The monitored `code_hash` is the zero hash and
  the resolved hash is the published vault code.
- **No full-access key:** the factory created the account without one, and nothing in the vault can
  add one. The one function-call key is the agent's; it can call only `spend` and
  `refresh_class` on the vault (`docs/NEAR-FACTS.md` §2, §10: T5 and T8).
- **Clean imports:** the compiled vault imports four promise host functions —
  `promise_batch_create`, `promise_batch_action_transfer`, `promise_batch_action_delete_key`,
  `promise_batch_action_add_key_with_function_call` — and none of the six the classifier scans.
  Check the file: `node packages/cli/dist/index.js imports contracts/vault/res/aruna_vault.wasm`.

## What this does and does not claim

It claims no detected upgrade path under the classifier's checks: no key and no linked host function
can replace this vault's code, re-point it, add a full-access key, or delete the account to free the
name (T9). It does not claim the vault code is free of bugs — immutability is also why a bug can never
be patched, which is why migration tooling is required before any mainnet vault
(`docs/BUILD-PLAN.md`, stage 6). Four host functions are still under review and not scanned in v0.

The same property is proven on a local sandbox, with the agent-key refusals:
`cd contracts && cargo test -p aruna-integration -- --nocapture`.

**This vault version predates the fixes in `docs/AUDIT-v0.md`** (H1, M1, M2, L2). Vaults are
immutable, so it keeps them; it holds no real value and exists to show self-classification. The
fixed version is the one built from `contracts/vault` today and tested in `contracts/integration`.
