# Aruna

**Aruna measures whether the contracts an agent touches can still change — and found a class that
can change without any transaction touching them, and without the field everyone monitors ever
changing.**

On NEAR, an account can run a *global contract published by another account*. When that owner
redeploys, the account executes new code, no transaction touches it, and `view_account.code_hash`
stays `11111111111111111111111111111111`. Monitoring keyed on that field never sees the change.
Aruna classifies any NEAR account into one of four classes from three public RPC reads, shows the
evidence, and gives agents a keyless tool to ask before they send funds.

Release v0, 14 November 2026. Everything below runs from a fresh clone. Each step says what you
should see.

---

## Steps

Requirements: Node 20+, pnpm 9 (`corepack enable`). Steps 8 and 10 also need Rust ≥ 1.95 and
`cargo-near`. Deploying your own copies (steps 4, 9 and 11) needs `near-cli-rs` ≥ 0.31 and a funded
testnet account, and running the agents in `examples/` needs Node ≥ 22.18; reading ours needs
nothing.

### 1. Install, build and test

```bash
pnpm install
pnpm -r build
pnpm -r test
```

Expected: every package builds; tests pass in `classifier-core` (47), `rpc` (32, 3 live tests
skipped), `cli` (8), `sdk` (5), `mcp` (4) and `apps/web` (57).

### 2. Classify any NEAR contract

```bash
node packages/cli/dist/index.js classify wrap.near
```

Expected: JSON with `"class": "local_upgradeable"`, `"mutabilityBasis": "upgrade_imports"`,
`"fullAccessKeyCount": 0` and `upgradeImports` listing `promise_batch_action_deploy_contract`,
`promise_batch_action_add_key_with_full_access` and `promise_batch_action_delete_account`. No key
can replace wrap.near's code, but its code links the host functions that could; Aruna reports that
as "cannot be ruled out", never as "can be upgraded".

### 3. One live account per class

```bash
for a in fx-imm fx-upg fx-guser fx-nocode; do
  node packages/cli/dist/index.js classify $a.arunafi.testnet --network testnet | grep -m1 '"class"'
done
```

Expected, in order: `immutable_verified`, `local_upgradeable`, `global_by_account`, `unknown`.
How each account was built: [`fixtures/README.md`](fixtures/README.md).

### 4. The invisible change

```bash
node fixtures/drift-demo.mjs
```

Expected: for `fx-guser.arunafi.testnet`, `view_account.code_hash` is
`11111111111111111111111111111111` while `view_code hash` is a real hash and `version()` returns
`v2`. The recorded run that switched it from v1 to v2 — with no transaction touching `fx-guser` —
is in `fixtures/README.md`. To make it happen yourself under your own testnet account:

```bash
ARUNA_TESTNET_ACCOUNT=you.testnet bash fixtures/deploy.sh
ARUNA_TESTNET_ACCOUNT=you.testnet node fixtures/drift-demo.mjs --redeploy
```

Expected: `view_account.code_hash changed: no`, `view_code hash changed: YES`,
`executed behaviour changed: YES`.

### 5. The classifier page, from a static host

```bash
pnpm --filter @aruna/web build
python3 -m http.server 4173 --directory apps/web/out
```

Open `http://localhost:4173`, click `fx-guser.arunafi.testnet`. Expected: class
`global_by_account` and a side-by-side table: `view_account.code_hash` marked wrong, `view_code.hash`
marked as the code that runs. The tab reads public RPC directly — no backend, no wallet. Switch
the selector to mainnet and type `wrap.near` for a mainnet read.

### 5b. The console and the public agent page

With the static host from step 5 still running, open `http://localhost:4173/console/lookup/`. It reads
`demo2.factory.arunafi.testnet` live through `@aruna/sdk` `readVault`, with no login. Expected: owner
`demo-client.arunafi.testnet`, operator `demo-company.arunafi.testnet`, `0` full-access keys, and a list
of agents. Click an agent. Expected: a page listing what its key cannot do, its limits and usage, and a
`curl` for `view_access_key_list` whose output you can compare by hand. The other console screens
(`/console/dashboard/`, `/console/coverage/`, `/console/claims/`) run on mock data until the contracts are wired in.

### 6. Ask from an agent (MCP)

```bash
claude mcp add aruna -- node "$(pwd)/packages/mcp/dist/index.js"
```

Then ask: *"Use aruna_check_target on fx-guser.arunafi.testnet on testnet."* Expected:
`global_by_account`, with a reason naming `fx-gowner.arunafi.testnet` as the account that can
redeploy it. Keyless: any agent on NEAR can call it. Then: *"Use aruna_read_vault on
demo2.factory.arunafi.testnet."* Expected: 0 full-access keys, agent `injected` paused and
auto-disabled, exposure to `swap.arunafi.testnet` as `local_upgradeable` (the vault from steps 9
and 11). Details: [`packages/mcp/README.md`](packages/mcp/README.md).

### 7. The mainnet measurement

```bash
pnpm measure
```

Re-classifies the committed list of the 1,000 most-called mainnet contracts and writes
`measurement/results/rerun/`. Takes about 15 minutes on public RPC. Expected: class counts close
to the published table below; they can differ by a few accounts because mainnet state moves.
Source query, window and raw data: [`measurement/`](measurement/).

### 8. The protocol evidence

```bash
cd lab/owed
for c in fconly keymgr keymgr_promise; do (cd contracts/$c && cargo near build non-reproducible-wasm --no-abi); done
cargo run --release -p owed -- all
```

Runs T5–T9 on a local sandbox (nearcore 2.14, protocol 88). Expected: a function-call key cannot
`UseGlobalContract` (`RequiresFullAccess`), an agent key cannot reach a `cb_` method
(`MethodNameMismatch`), a contract with no full-access key manages its own function-call keys, and
a self-deleting child lets its parent recreate the name with other code. Results:
`docs/NEAR-FACTS.md` §10.

### 9. Aruna's own vault classifies as immutable

```bash
node packages/cli/dist/index.js classify demo2.factory.arunafi.testnet --network testnet
```

Expected: `"class": "immutable_verified"`, `"fullAccessKeyCount": 0`, `"functionCallKeyCount": 2`
(the two agents' keys), `"upgradeImports": []`, `"resolvedCodeHash":
"4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam"`, the hash of `contracts/vault/res/aruna_vault.wasm`
(`node fixtures/tools.mjs hash contracts/vault/res/aruna_vault.wasm`). The vault was created by
`factory.arunafi.testnet` from one global contract by hash, with no key; the operator then added the
agent keys. Details and evidence: [`docs/SELF-CLASSIFICATION.md`](docs/SELF-CLASSIFICATION.md). To
deploy your own copy: `ARUNA_TESTNET_ACCOUNT=you.testnet bash scripts/testnet-setup.sh` (about 35
NEAR, most of it the one-time global contract publish).

### 10. What an agent can and cannot do

```bash
(cd fixtures/contracts/swap && cargo near build non-reproducible-wasm --no-abi --out-dir ../../wasm/swap)
cd contracts
for c in registry vault factory; do (cd $c && cargo near build non-reproducible-wasm --no-abi); done
cargo test -p aruna-integration -- --nocapture --test-threads 2
```

Runs on a local sandbox, no account needed; 5 tests pass in about 1–3 minutes after compiling. One
test fast-forwards the chain 3,601 blocks, so cargo may report it running for over 60 seconds; that
is expected. A factory creates a vault with zero access
keys and the operator adds agents. Expected output:

- **Isolation.** The agent's key tries forbidden actions, each rejected by the network before
  reaching a block: transfer (`RequiresFullAccess`, or `NotEnoughAllowance` above its allowance),
  add a full-access key and deploy code (`RequiresFullAccess`), call another contract
  (`ReceiverMismatch`), call `withdraw_to_owner` (`MethodNameMismatch`), attach a deposit
  (`DepositWithFunctionCall`), call `cb_settle` or `cb_refresh_class` (`MethodNameMismatch`).
  After revocation the key no longer exists.
- **Honest agent.** A swap of 0.5 NEAR settles; the proceeds return to the vault and exposure
  records what was sent. A target that fails releases the reservation and records nothing.
- **Re-check at execution.** With no cached class: `ARUNA_CLASS_STALE`. After the registry
  reclassifies the target as `global_by_account`: `ARUNA_RISK_CLASS_NOT_ALLOWED`. Past 3,600
  blocks: stale again until `refresh_class`.
- **Parallel requests.** `10 parallel x 0.4 NEAR, cap 2 NEAR -> 5 settled, 5 refused at the cap`.
- **Injected agent.** Three attempts to pay an outside contract return `ARUNA_TARGET_NOT_ALLOWED`;
  the third pauses the agent (`agent_auto_disabled`). The operator cannot resume it; the owner can.

Refusals are returned values with an `execution_rejected` event, never panics.

### 11. The same agents, on testnet

```bash
node fixtures/tools.mjs view demo2.factory.arunafi.testnet get_agents
node fixtures/tools.mjs view demo2.factory.arunafi.testnet get_exposure '{"target":"swap.arunafi.testnet"}'
```

No key needed. Expected: agent `honest` is `Active` with swaps settled and exposure recorded against
`swap.arunafi.testnet` as `local_upgradeable`; agent `injected` is `Paused` with
`"auto_disabled":true`. They got there by running [`examples/honest-agent.ts`](examples/honest-agent.ts)
and [`examples/injected-agent.ts`](examples/injected-agent.ts): the injected agent follows a
poisoned tool result, five spends are refused (`ARUNA_TARGET_NOT_ALLOWED`,
`ARUNA_MAX_PER_TX_EXCEEDED`, `ARUNA_SLIPPAGE_TOO_HIGH`), the fifth pauses it, and an in-policy swap
after that is refused with `ARUNA_AGENT_AUTO_DISABLED`. The recorded runs with every transaction
link, and how to run them against your own vault: [`examples/README.md`](examples/README.md).

---

## The measurement

The 1,000 mainnet accounts that received the most function calls from 9 October to 8 November
2026, classified on 9 November 2026 (997 classified, 3 not readable over RPC). Full report:
[`measurement/REPORT.md`](measurement/REPORT.md).

| Share of function calls received | Went to |
|---|---|
| **44.2%** | contracts where a full-access key exists: its holder can replace the code at any moment |
| **54.6%** | contracts with no full-access key whose code imports a deploy, full-access-key or delete-account host function: a path cannot be ruled out |
| **0.4%** | contracts with no detected upgrade path (`immutable_verified`) |
| 0.7% | accounts with no code, almost all of which do not exist |

Three accounts in the list are `global_by_account`, including `npoint.noamarket.near`, which runs a
token contract published by `ft.globals.primitives.near`. Their `view_account.code_hash` is the
zero hash. The class is rare in the top 1,000 (0.3%); what it shows is that hash-based monitoring
is wrong for every account in it, on mainnet, today.

---

## The four classes

| Class | Means | Basis values |
|---|---|---|
| `immutable_verified` | code pinned by hash, no full-access key, none of the scanned host functions imported: no detected upgrade path under these checks | `no_detected_path` |
| `local_upgradeable` | an upgrade path exists or cannot be ruled out | `full_access_key`, `upgrade_imports`, `own_code` |
| `global_by_account` | runs code another account can redeploy, invisibly to `view_account.code_hash` | `global_owner` |
| `unknown` | no code, or code that cannot be fetched or parsed — never read as safe | `undetermined` |

Why absence of an import is sound: a WebAssembly contract cannot call a host function it does not
import. Full procedure: [`docs/CLASSIFIER.md`](docs/CLASSIFIER.md). One engine,
`@aruna/classifier-core`, has zero dependencies and runs unchanged in the browser page, the CLI and
the MCP server.

## Trust assumptions

Classification needs none: anyone can re-run the three RPC reads and get the same answer. The
coverage layer on the roadmap adds two, stated here before it ships:

1. **The attestor.** Detecting that code changed needs an off-chain observer; five on-chain routes
   were tested and are closed (`docs/NEAR-FACTS.md` §1).
2. **The arbiter.** Disputed drift reports are resolved by a designated account.

Aruna is verifiable and reproducible. It is not trustless.

## Limits

- A contract cannot read another account's code; checks happen off chain, and the gap between a
  check and execution is at least 3 blocks (`docs/NEAR-FACTS.md` §5).
- `upgrade_imports` says a capability is linked, not that a route is reachable. A near-sdk
  contract written with `Promise` linked all six scanned functions in our build, whether it used
  them or not (`docs/NEAR-FACTS.md` §10).
- Four host functions are still under review and not scanned in v0 (`docs/CLASSIFIER.md`).
- Accounts with more access keys than `view_access_key_list` returns cannot be classified over RPC
  and are reported as not classified.

## What is in v0, and what is not

| In v0 | Not yet |
|---|---|
| `@aruna/classifier-core`, `@aruna/rpc`, `@aruna/cli` | exposure checkpoints, indexer, console on real data |
| live classifier page (`apps/web`) | migration tooling between vault versions |
| keyless MCP tools, `@aruna/sdk` `Classifier` and `readVault` | coverage pool, attestor, claims, simulation |
| mainnet measurement with raw data and query | mainnet anything that holds funds |
| testnet fixtures and the drift demo | |
| lab evidence T0–T9 | |
| vault, registry and factory on testnet; vault self-classified `immutable_verified` | |
| spend path, reservations, auto-disable and one swap adapter, proven on a sandbox | |
| the same spend path on testnet: an honest and an injected agent (`examples/`) | |

Build order and release gates: [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md).

## Repository

```
packages/classifier-core   the engine: account id + RpcReader -> class + evidence, zero deps
packages/rpc               fetch-based RpcReader with endpoint fallback, browser-safe
packages/cli               aruna classify | measure | imports
packages/sdk               keyless Classifier, readVault, refusal reason codes
packages/mcp               MCP server: aruna_check_target, aruna_explain_class, aruna_read_vault
apps/web                   static classifier page, spec, proof and console shell
fixtures/                  one testnet account per class, the drift demo
examples/                  an honest and a prompt-injected agent against the testnet vault
measurement/               BigQuery query, raw export, results, report
lab/                       sandbox protocol evidence (T0–T9)
docs/                      architecture, decisions, protocol facts
```

## Credits

Built with Claude Code (Anthropic) as a coding agent; AI-generated code is reviewed and tested as
described above. Libraries: `@modelcontextprotocol/sdk`, `zod`, `vitest`, `typescript`, Next.js and
React (web), `near-sdk`, `near-primitives`, `near-sandbox` (contracts and lab), `near-cli-rs`
(fixtures). Data: the NEAR public BigQuery dataset.

MIT License.
