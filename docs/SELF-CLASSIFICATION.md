# Aruna's vault, classified by Aruna's own classifier

A vault created by the factory on testnet, read with the same engine that classifies any NEAR
account. Re-run it yourself:

```bash
pnpm install && pnpm -r build
node packages/cli/dist/index.js classify demo2.factory.arunafi.testnet --network testnet
```

Expected: `"class": "immutable_verified"`, `"mutabilityBasis": "no_detected_path"`,
`"fullAccessKeyCount": 0`, `"functionCallKeyCount": 2`, `"upgradeImports": []`.

## What was deployed (10 November 2026, testnet)

| Account | Role |
|---|---|
| `registry.arunafi.testnet` | classifier set, class records and vault versions; owner `arunafi.testnet` |
| `factory.arunafi.testnet` | creates vaults by global hash, adds no key |
| `demo-client.arunafi.testnet` | the client: owner of the vaults |
| `demo-company.arunafi.testnet` | the agent-as-a-service company: operator |
| `swap.arunafi.testnet` | the swap fixture, the one adapter target; registry class `local_upgradeable` |
| `demo2.factory.arunafi.testnet` | **the current vault**, version `4hDwnc…`, with two agents (`examples/`) |
| `demo.factory.arunafi.testnet` | the first vault, version `5s1ggtt…`, kept as it is |

Two vault versions, each published once as a global contract by hash:

| Version | Code hash | File | Size | Publish fee |
|---|---|---|---|---|
| v3, coverage stack | `2NvTPrL33u6SXVmdEDN2i8iYp76eMf9kPFJK7zGscmSH` | `contracts/vault/res/aruna_vault.wasm` | 285,648 bytes | 28.567 NEAR |
| v2 | `4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam` | `contracts/vault/res/aruna_vault-v2.wasm` | 236,478 bytes | 23.649 NEAR |
| v1 | `5s1ggttSbdcSxSCjRyxqKmWUC7sCR6MLB26z7eMLhPhq` | `contracts/vault/res/aruna_vault-v1.wasm` | 191,619 bytes | 19.163 NEAR |

Recompute either hash: `node fixtures/tools.mjs hash <file>`. The factory's
`set_vault_code_hash` moved new vaults to the current version (event `vault_version_set`); the first
vault kept its code, because no vault can change its own. The registry records each vault with its
code hash and owner. The operator then added two agent keys; the vault added them to itself.

## The evidence, as read

```json
{
  "class": "immutable_verified",
  "evidence": {
    "accountId": "demo2.factory.arunafi.testnet",
    "checkedAtBlock": 277069081,
    "codeRef": {
      "kind": "global_hash",
      "globalHash": "4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam"
    },
    "fullAccessKeyCount": 0,
    "functionCallKeyCount": 2,
    "monitoredCodeHash": "11111111111111111111111111111111",
    "resolvedCodeHash": "4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam",
    "upgradeImports": [],
    "mutabilityBasis": "no_detected_path",
    "wasmParsed": true
  }
}
```

- **By hash:** `codeRef.kind` is `global_hash`. The monitored `code_hash` is the zero hash and
  the resolved hash is the published vault code.
- **No full-access key:** the factory created the account without one, and nothing in the vault can
  add one. The two function-call keys are the agents'; each can call only `spend` and
  `refresh_class` on the vault (`docs/NEAR-FACTS.md` §2, §10: T5 and T8). See them with
  `node examples/add-agents.ts`'s last lines, or any `view_access_key_list` on the vault.
- **Clean imports:** the compiled vault imports promise host functions for calls, callbacks,
  transfers and its own keys — `promise_create`, `promise_then`, `promise_result`,
  `promise_batch_create`, `promise_batch_action_transfer`, `promise_batch_action_delete_key`,
  `promise_batch_action_add_key_with_function_call` — and none of the six the classifier scans.
  Check the file: `node packages/cli/dist/index.js imports contracts/vault/res/aruna_vault-v2.wasm`
  (expected `"scannedPresent": []`).

## What this does and does not claim

It claims no detected upgrade path under the classifier's checks: no key and no linked host function
can replace this vault's code, re-point it, add a full-access key, or delete the account to free the
name (T9). It does not claim the vault code is free of bugs — immutability is also why a bug can never
be patched, which is why migration tooling is required before any mainnet vault
(`docs/BUILD-PLAN.md`, stage 6). Four host functions are still under review and not scanned in v0.

The same property is proven on a local sandbox, with the agent-key refusals:
`cd contracts && cargo test -p aruna-integration -- --nocapture`.

**The first vault predates the fixes in `docs/AUDIT-v0.md`** (H1, M1, M2, L2). Vaults are
immutable, so it keeps them; it holds no real value. `demo2` runs the current version, which includes
them, and is the vault the agent examples use.

## Vault v3, on the coverage stack (11 November 2026)

`demo3.factory2.arunafi.testnet` runs vault v3: limits per token, the `ft_swap` adapter, exposure
checkpoints and freezes (`docs/CONTRACTS.md`). It was created by `factory2.arunafi.testnet`, which
registers vaults with `registry2.arunafi.testnet` (`scripts/testnet-coverage-setup.sh`). Same check:

```bash
node packages/cli/dist/index.js classify demo3.factory2.arunafi.testnet --network testnet
```

Expected `"class": "immutable_verified"` and `"upgradeImports": []`; the wasm passes the same import
gate (`node packages/cli/dist/index.js imports contracts/vault/res/aruna_vault.wasm` shows
`"scannedPresent": []`). As read on 11 November 2026, with the demo agent's function-call key:

```json
{
  "class": "immutable_verified",
  "evidence": {
    "accountId": "demo3.factory2.arunafi.testnet",
    "checkedAtBlock": 277105004,
    "codeRef": {
      "kind": "global_hash",
      "globalHash": "2NvTPrL33u6SXVmdEDN2i8iYp76eMf9kPFJK7zGscmSH"
    },
    "fullAccessKeyCount": 0,
    "functionCallKeyCount": 1,
    "monitoredCodeHash": "11111111111111111111111111111111",
    "resolvedCodeHash": "2NvTPrL33u6SXVmdEDN2i8iYp76eMf9kPFJK7zGscmSH",
    "upgradeImports": [],
    "mutabilityBasis": "no_detected_path",
    "wasmParsed": true
  }
}
```

