# Component map

Mapped 13 November 2026 against `main` at `7c0af16`, from the code and from read-only chain views. Each wiring claim says
how it was established: **[RUN]** a command was run and its output read, **[READ]** read from code only,
**[UNKNOWN]**.

Deployed stack (testnet): `registry2.arunafi.testnet`, `pool2.arunafi.testnet`, `factory2.arunafi.testnet`, vaults
`<name>.factory2.arunafi.testnet`. The older stack (`registry`, `factory`, vaults `<name>.factory.arunafi.testnet`
such as `demo2`) still runs and is not connected to `pool2` (D-60).

---

## 1. Contracts (`contracts/`, Rust, near-sdk 5.30)

| Contract | Responsibility | Called by | Calls out to |
|---|---|---|---|
| `common` | Shared types (`RiskClass`, `DriftReport`, `TokenId`), `Reason` codes, events, params (`MAX_CLASS_AGE_BLOCKS` 3600, challenge window, heartbeat staleness) | linked into all four | — |
| `factory` | `create_vault`: new account, `use_global_contract(vault_code_hash)`, `new`; then `register_vault` | console Create screen, `examples/*`, SDK | vault `new`, registry `register_vault` |
| `vault` | One per client. Named actions only (`spend` with `swap`/`ft_swap` adapters), per-agent policy, ceiling, exposure checkpoints, class cache | agent keys (`spend`, `refresh_class`, `simulate`), owner/operator (agent and policy admin), registry (`freeze_target`), pool (views) | target `swap` / token `ft_transfer_call`, registry `get_class`, own `cb_settle` / `cb_refresh_class` |
| `registry` | Class records, freeze flag, attestors (bond, heartbeat, signing key, assignment), drift reports and their states, vault list, allowed vault code hashes | keeper (`set_class`, `lift_freeze`, `push_freeze`), attestor (`heartbeat`, `report_drift`), owner (admin), factory (`register_vault`), pool (views), vaults (`get_class`), anyone (`push_freeze`) | vault `freeze_target` (from `push_freeze`), pool `receive_slash` |
| `pool` | Underwriter capital, `quote`, `buy_coverage` (premium), `claim`, payouts, book totals | console Buy and Claims screens, SDK, `examples/coverage-demo.ts` | registry `get_allowed_vault`, `get_class`, `heartbeat_fresh`, `get_report`; vault `get_agent`, `exposure_before`; transfers |

Interface consistency:

- The contract sources' public methods equal the method lists in `packages/sdk/src/generated/*.ts` (the ABI also lists
  `contract_source_metadata`); `node scripts/gen-abi-types.mjs --check` exits 0 [RUN].
- Every method name the TypeScript packages call exists in the contract they call [RUN, name comparison].
- Deployed code: `test-vault-0.factory2` uses global hash `6fqp3des…`, equal to `contracts/vault/res/aruna_vault.wasm`
  and to `factory2.get_config.vault_code_hash` [RUN]. `registry2`, `pool2` and `factory2` do **not** equal the committed
  `res/*.wasm`: their NEP-330 metadata names commit `5574bc8`, built in `sourcescan/cargo-near:0.21.1`, and no contract
  source outside tests changed between the commits that wrote `res/*.wasm` and `5574bc8`, nor since [RUN]. So the
  deployed logic matches `main`, but the hash in `res/` is a local build; `docs/AUDIT-v0.md`'s statement that pool2 equals
  the committed wasm was true on 12 November and is no longer. `scripts/testnet-*-setup.sh` deploy the `res/` files.

## 2. Services and packages (`packages/`, TypeScript)

| Package | Entry point | Responsibility | Input | Output | Depends on | Who runs it |
|---|---|---|---|---|---|---|
| `classifier-core` | library | The one classification engine: wasm imports, keys, global-contract kind -> class | account state, code, keys (`RpcReader`) | class + evidence | none (frozen surface) | rpc, sdk, cli, attestor, keeper, web |
| `rpc` | library | `RpcReader` over fetch, endpoints, retries | RPC URL | reader | classifier-core | sdk, cli, attestor, keeper, web |
| `sdk` | library (`.`, `/vault`, `/coverage`) | Typed clients: `readVault`, agent `spend`/`simulate`/`refreshClass` (retries once on `CLASS_STALE`), `Registry`, `Pool`, migration plan | transport (near-api-js or fetch view) | typed results, `Reason` codes | classifier-core, rpc, near-api-js | mcp, cli, keeper, web, examples |
| `mcp` | `aruna-mcp` (stdio) | 12 tools: check/explain/watch target, read vault, simulate, spend, budget, exposure, coverage quote/book/coverage, drift report | `ARUNA_AGENT_VAULT`, `ARUNA_AGENT_KEY_FILE`, `ARUNA_REGISTRY`, `ARUNA_POOL`, `ARUNA_RPC_TESTNET` | MCP tool results | sdk | an agent host (Claude, etc.) |
| `cli` | `aruna` | `classify`, mainnet `measure`, `migrate` plan | args | text / JSON / CSV | classifier-core, rpc, sdk | operator, README steps |
| `attestor` | `aruna-attestor`, Railway | Watches assigned targets, files signed `report_drift`, `heartbeat` every ~3 min, state in `/data` | `ARUNA_ATTESTOR_*`, `ARUNA_INDEXER_URL`, RPC | registry transactions | classifier-core, rpc, indexer client, near-api-js | Railway service [log read by operator] |
| `keeper` | `aruna-keeper`, Railway | After a report is final: re-classify, `lift_freeze`, `set_class`; holds the freeze when riskier | `ARUNA_KEEPER_*`, `ARUNA_INDEXER_URL`, RPC | registry transactions | classifier-core, rpc, sdk, indexer client | Railway service [log read by operator] |
| `indexer` | `aruna-indexer`, Railway | Follows chain events (`standard: "aruna"`) into Postgres; HTTP: `health`, `vaults`, `events`, `classes`, `freezes`, `reports`, `heartbeats`, `attestors`, `coverages`, `claims`; `createIndexerClient` | `DATABASE_URL`, `ARUNA_INDEXER_CONFIG`, `PORT` | JSON API | postgres | Railway; read by web, attestor, keeper. `/health` `healthy:true, lag_blocks:0` [RUN] |
| `sim` | `aruna-sim` | Pool solvency simulation from golden vectors of the pool's rules | scenarios | published results | none | web Simulation screen reads the output |

## 3. Apps

| App | Entry | Responsibility | Reads / writes | Config |
|---|---|---|---|---|
| `apps/web` | static Next.js, `https://www.arunafi.xyz` | Landing, classifier page, `/console/*` | chain via sdk/rpc (`REGISTRY`/`POOL` in `console/data/price.ts` = `registry2`/`pool2`; `FACTORY` in `console/data/factory.ts` = `factory2`), indexer via `NEXT_PUBLIC_INDEXER_URL`, wallet via near-connect | build-time env only |

Owned by Ilham. Guided demo (`Story`) runs on mock data, labelled as such.

## 4. Main flows and who drives each step

| Flow | Step | Driver | Status |
|---|---|---|---|
| Measurement | target -> class + evidence | cli / mcp / web -> classifier-core | [RUN] in earlier sessions; not re-run today |
| Protection | agent `spend` -> vault checks -> refuse/execute -> exposure | agent via sdk / mcp | [RUN] on `demo2` (old stack) earlier; not today |
| Coverage purchase | console -> `pool.buy_coverage` -> 4 views -> `cb_buy` | wallet | [RUN] coverage #5 on 13 Nov |
| Drift: report | code change -> attestor `report_drift` -> registry freezes target | attestor (hosted) | **not run with the hosted attestor** |
| Drift: freeze reaches vaults | registry `push_freeze` -> each vault `freeze_target` | keeper, from 14 Nov (needs the new key) | G1 fixed in code; not run on chain |
| Drift: release | report final -> keeper re-classifies -> `lift_freeze`, `set_class` | keeper (hosted) | [log read] on report 2 only |
| Drift: release reaches vaults | vault cache refreshed by `refresh_class` | agent sdk on `CLASS_STALE`, and on `TARGET_FROZEN` when the registry has lifted | G2 fixed in the SDK; not run on chain |
| Claim | console -> `pool.claim` -> report + exposure views -> payout | wallet | [RUN] coverage #2 via example script; **never from the console** |

## 5. Gaps and inconsistencies found while mapping

- **G1. Nothing hosted calls `push_freeze`.** *Fixed in code 14 Nov: the keeper pushes (`packages/keeper/README.md`);
  the hosted keeper needs a key that allows `push_freeze`.* [READ] The attestor calls only `heartbeat` and `report_drift`
  (`packages/attestor/src/submit.ts`); the keeper only `set_class` and `lift_freeze`; the one caller is
  `examples/coverage-demo.ts`. D-59 says the freeze "is pushed in batches to every vault". Without the push, a vault
  learns of a freeze only when its cached class is older than `MAX_CLASS_AGE_BLOCKS` (3600, about an hour) and someone
  calls `refresh_class`. Until then an agent can keep spending into the changed target. `registry2` has 10 vaults [RUN].
- **G2. A vault stays frozen after the keeper lifts the freeze.** *Seen on chain 14 Nov: `demo3` and `demo4` hold
  `drift-target` frozen (`fetched_at_block` 277193110) while `registry2` reads `frozen:false` [RUN]. Fixed in the SDK:
  `AgentVault.spend` refreshes on `TARGET_FROZEN` when the registry has lifted; an agent not using the SDK still has to
  call `refresh_class`.* [READ] `freeze_target` sets `frozen` in the vault's
  cache without touching `fetched_at_block`; `spend` checks `frozen` before staleness, so it returns `TARGET_FROZEN`,
  never `CLASS_STALE`, and the SDK's automatic `refresh_class` (only on `CLASS_STALE`) never fires. Someone has to call
  `refresh_class` on that vault by hand. Only reachable once G1's push has happened.
- **G3. Committed `res/*.wasm` for registry, pool, factory differ by hash from what runs on chain** (section 1). Logic is
  the same by source diff; reproducing the deployed hash needs the sourcescan image at `5574bc8`, not untested here.
- **G4. The console's example vault is on the old stack.** `EXAMPLE_VAULT` in `apps/web/src/console/screens/Lookup.tsx`
  and README step 5b use `demo2.factory.arunafi.testnet`, whose `registry` is `registry.arunafi.testnet` [RUN], while
  every other console screen uses `registry2`. Not wrong for Lookup (it reads the vault), but a vault from that stack
  cannot buy coverage on `pool2`. Ilham's area.
- **G5. Coverage purchase screen** does not pre-check window > 30 days or agent class (`PROJECT_STATE.md` §4.2). Ilham's area.
