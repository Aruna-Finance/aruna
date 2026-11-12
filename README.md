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

Requirements: Node 22.13+ (the indexer's tests use `node:sqlite`), pnpm 9 (`corepack enable`).
Steps 8 and 10 also need Rust ≥ 1.95 and `cargo-near`. Deploying your own copies (steps 4, 9 and 11)
needs `near-cli-rs` ≥ 0.31 and a funded testnet account, step 5d needs a testnet wallet holding at
least 0.5 NEAR plus gas, and running the agents in `examples/` needs Node ≥ 22.18; reading ours
needs nothing.

### 1. Install, build and test

```bash
pnpm install
pnpm -r build
pnpm -r test
```

On Windows, `pnpm -r test` stops at two tests that depend on the platform: `sdk` `abi-drift` fails if git
checked the files out with CRLF line endings (`git config core.autocrlf false`, then check out again, and it
passes), and `indexer` `cli.test.ts` "read-only directory" fails because Windows ignores the directory
permission it relies on. `pnpm -r --no-bail test` runs the rest.

Expected: every package builds; tests pass in `classifier-core` (47), `rpc` (32, 3 live tests
 skipped), `cli` (8), `attestor` (13), `sdk` (74), `mcp` (22), `indexer` (95, 3 skipped), `sim` (36) and `apps/web` (244).

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
`curl` for `view_access_key_list` whose output you can compare by hand.

Which console screens read the chain: Lookup and the public agent page (this step), Create a vault,
Agents and agent detail (step 5d), the Playground (step 5e) and the Overview (step 5f). Every other
screen — Targets, Coverage, Claims, Migration, Pool, Simulation, Attestor and the Guided demo — still
runs on sample data in v0. Treat the numbers on those screens as illustrations, not results; the
results are in steps 9 to 13.

### 5c. Connect a testnet wallet

You need a testnet wallet account. With the static host still running, open `http://localhost:4173/console/lookup/`
and click `Connect wallet` in the header. Expected: a wallet picker opens; after you sign in with a testnet account,
the header shows that account id and a `Disconnect` button, and the Lookup page adds a line saying whether your
account is the vault owner, the operator, or neither (for `demo2.factory.arunafi.testnet` it is neither, unless you
sign in as its owner). Closing the picker is not an error. Every transaction the console sends is shown in a
preview first — receiver, method, deposit and gas — and declining it sends nothing.

### 5d. Create your own vault and an agent

With a wallet connected, open `http://localhost:4173/console/create/`. Pick a vault name, keep yourself
as operator or name another account, and deposit at least 0.5 NEAR, the minimum
`factory2.arunafi.testnet` requires (`node fixtures/tools.mjs view factory2.arunafi.testnet get_config`
shows `"min_deposit":"500000000000000000000000"`). Expected: a preview of `create_vault` on
`factory2.arunafi.testnet`; after you sign, the screen shows the new `<name>.factory2.arunafi.testnet`
with your account as owner, its balance and `0` full-access keys. Check it yourself:

```bash
node packages/cli/dist/index.js classify <name>.factory2.arunafi.testnet --network testnet
```

Expected: `"class": "immutable_verified"`, `"fullAccessKeyCount": 0` and `"upgradeImports": []`, as for
`l2ocbae.factory2.arunafi.testnet`, a vault created this way on 11 November 2026.

Then open `Manage agents` and `Create an agent`. Expected: the wizard generates the agent's key pair in
the browser, previews `add_agent`, and after you sign, the agent appears in the list. `view_access_key_list`
on the vault then shows one function-call key whose `method_names` are `spend` and `refresh_class`.

The ceiling lists the targets `registry2.arunafi.testnet` has classified. `swap.arunafi.testnet` was
classified there on 12 November 2026 (transaction `EFuXBSrLsKCWXaTpf1xt7Wkzu554URHroJDj5WwbnTaX`):

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet get_class '{"target":"swap.arunafi.testnet"}'
```

Expected: `"class":"local_upgradeable"`, `"frozen":false`, `"classifier":"arunafi.testnet"`. So a vault
created here can admit the swap target, at most `local_upgradeable`.

Sent from these screens on testnet: add agent, pause, resume, revoke, add a target to the ceiling and
tighten a policy (Daily cap 0.4 to 0.2 NEAR on `arunaTest#1`, which then reads `policyVersion` 2). Deposit,
withdraw, loosen, and changing the operator or the ceiling's limits were sent from a script that uses the same
SDK calls, on a throwaway vault, not from these screens. Every scenario, with its transaction hashes and
whether it was seen on a screen, is in [`docs/CONSOLE-TESTING.md`](docs/CONSOLE-TESTING.md).

### 5e. Run an agent from the console

You need a vault from step 5d whose ceiling holds `swap.arunafi.testnet`, an agent whose allowed targets
include it (the wizard's Targets step), and about 0.5 NEAR in the vault. The agent's key must be in this
browser, which it is if you created the agent here. Open
`http://localhost:4173/console/playground/?vault=<your vault>`.

1. Choose the agent and **Honest agent**. Expected: five lines marked **Ready** under "Before it starts".
   Click **Run the scenario**. Expected: one line, `spend(swap.arunafi.testnet, 0.1 NEAR)`, marked **Settled**
   with a transaction link, and the agent still Active.
2. Choose **Injected agent** and click **Run the scenario**. Expected, in this order:
   `TARGET_NOT_ALLOWED`, `MAX_PER_TX_EXCEEDED`, `SLIPPAGE_TOO_HIGH`, `TARGET_NOT_ALLOWED`, `TARGET_NOT_ALLOWED`, each as
   **Refused** with a transaction link, then "The vault paused the agent", and the sixth attempt marked
   **Not sent**. These are returned outcomes recorded on chain, not errors.
3. Check it on chain, without trusting the page:

```bash
node fixtures/tools.mjs view <your vault> get_agents '{}'
```

Expected: the agent has `"status":"Paused"` and `"auto_disabled":true`. Only the owner can resume it
(`Agents`, then **Resume**). A check that fails shows its reason and a link: for example, an agent whose own
allowed targets lack the swap would be refused `TARGET_NOT_ALLOWED` on every swap, so the page says so before it sends.

Seen on a screen on 12 November 2026 on `l2ocbae.factory2.arunafi.testnet`: both scenarios, with these
results. The same flow, driven by a script with the same modules, is on `f1pbr5p.factory2.arunafi.testnet`:
create `Msk9MYW7RHHDpr8bNejGG2uhdvg4e51ErY54PuiHsXB`, add agent `3D4rqmUowjZsfrmktiwEayPvnZbBuhCoUueU1CuJUYEK`, honest swap `9ogGGWj3T1aNBtfkaDvdbkN4utkPtYxQiDLucP9nRif2`, tighten `9uRdLXuRYU3dfKDA2KRxGVyphPCs6SUyFw8SN1yDt1K2`, and the five
refusals `AYrRFG5kr4nUk3Ptpvvb1BpAgimB1adb6c9B2J8vq5Nh`, `EsvLAuGQ7jh4fKtDJHztQxADZ5GcB3DUp7ydsNNjT7Rm`, `fJEGUuexAmCQnzkBMjFCJ2jybfZ9ncbGwt89eKBovLb`, `4z31Cg3oZKM9qSpbARKJ3R3QWHGYfLyaAeHsfHsW7Cei`, `7t8n3b1uhUc4kybcURHeGUf2BKDYGD31eF74iLEUjTxg`. Check it with `node fixtures/tools.mjs view f1pbr5p.factory2.arunafi.testnet get_agents '{}'`: expected
`"status":"Paused"`, `"auto_disabled":true`. The Stop button and the "previous run was interrupted" notice pass unit
tests only.

### 5f. The overview, and what a policy costs

Open `http://localhost:4173/console/dashboard/?vault=<your vault>`. Expected: tiles for the vault balance,
active agents and recorded exposure, a table of your agents, and the contracts they touch with the exposure
recorded to each and the class recorded with it. Exposure is what was sent through the vault, not the value of a
position. These numbers come from `readVault`; they do not depend on the indexer.

Then open an agent (`Agents`, click its name), the **Policy** tab, and the panel **What this policy costs**. It
shows, for each allowed target, the pool's premium with the policy as it is on chain and with the draft you are
editing, the draft labelled "proposed, not yet signed", and "Testnet, assumed numbers". Change **Daily cap** from
0.4 to 0.2 NEAR. Expected: the draft premium falls to about half and the on-chain one does not move. The price is
the pool contract's own; compare it by hand, for a `global_by_account` target at a 0.2 NEAR cap:

```bash
node fixtures/tools.mjs view pool2.arunafi.testnet quote '{"class":"global_by_account","limit":"6400000000000000000000000","payout_ratio_bps":8000,"window_blocks":1296000,"daily_cap":"200000000000000000000000"}'
```

Expected: `"premium":"666293333333333333333332"` (0.6662 NEAR) and `"reachable_payout":"4960000000000000000000000"`,
which is the cap times 31 days times 80%. The sum insured is set above that bound, so the price follows the cap.
Click **Save the policy** and sign: the panel then reads "No change from the current policy" and both columns match.

### 5g. History from the indexer: not met in v0

The Activity tab and the Overview list refusals and exposure rows from `@aruna/indexer`, with the reason, the
class at refusal and a transaction link. This build has no indexer URL (`NEXT_PUBLIC_INDEXER_URL` is unset), so
those panels say "History is not connected in this build" instead of showing data. The hosted indexer
(`https://aruna-near-indexer.up.railway.app`) answered on 12 November 2026 but had stopped at block 277,003,378,
about 370,000 blocks behind, so it held nothing for the vaults in these steps. To run the indexer yourself, see
[`packages/indexer`](packages/indexer/README.md); a backfill takes hours. Rebuild `apps/web` with
`NEXT_PUBLIC_INDEXER_URL=<your indexer>` to read it.

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
"4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam"`, the hash of `contracts/vault/res/aruna_vault-v2.wasm`
(`node fixtures/tools.mjs hash contracts/vault/res/aruna_vault-v2.wasm`). The vault was created by
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

### 12. Coverage: a code change, reported, frozen and paid

```bash
node fixtures/tools.mjs view pool2.arunafi.testnet get_coverage '{"id":2}'
node fixtures/tools.mjs view registry2.arunafi.testnet get_report '{"id":2}'
node fixtures/tools.mjs view pool2.arunafi.testnet quote '{"class":"global_by_account","limit":"1000000000000000000000000","payout_ratio_bps":8000,"window_blocks":43200,"daily_cap":"200000000000000000000000"}'
```

No key needed. Expected: coverage 2 has one claim with `"outcome":"paid"` and `"paid":"80000000000000000000000"`
(0.08 NEAR); report 2 is `"verified"`, `deploy_global_contract`, with two different resolved hashes
and `changed_at_block` 277193145; the quote returns its premium next to every input and the declared
assumptions. They come from one run of [`examples/coverage-demo.ts`](examples/coverage-demo.ts) on
11 November 2026, written against `@aruna/sdk/coverage`: two quotes that differ only in the agent's
daily cap, the SDK's quote equal to the pool's, purchase at the tighter price in NEAR and in a test
USDC, swaps, the target's code republished by account while its `view_account.code_hash` stays the
zero hash, a signed report from [`packages/attestor`](packages/attestor/README.md), the freeze
refusing the next spend, a claim refused during the challenge window, then paid by `min(exposure in
the window before the change × 80%, C)`. The recorded run, and how to run it against your own stack:
[`examples/README.md`](examples/README.md). On a sandbox, with no account:
`cargo test -p aruna-integration --test coverage -- --nocapture` (after the builds in step 10,
plus `pool`), which also runs a dispute upheld and rejected and a stale heartbeat.

### 13. The same state through the SDK, and through MCP

```bash
node examples/read-coverage.mjs
```

No key needed. Expected: the target's class `global_by_account`, its latest drift report `verified`,
the pool's NEAR book, and coverages 0 to 3 of vault `demo4.factory2.arunafi.testnet`, coverage 2 with
`paid out 80000000000000000000000` and coverage 3 (the test USDC) with `paid out 800000`. It is the
keyless half of `@aruna/sdk/coverage`. With an agent key, `node examples/mcp-smoke.mjs <agent label>`
starts the MCP server as a client would and calls `aruna_watch_target`, `aruna_budget`,
`aruna_simulate` (with a coverage shape: verdict `block: TARGET_FROZEN` and the coverage premium),
`aruna_spend` (the same refusal), `aruna_pool_book` and `aruna_drift_report` against the real vault.

### 15. The pool simulation

```bash
node packages/sim/dist/run.js --check packages/sim/results/2026-11-12
```

Expected: `ok: 10 files ... equal what raw/ produces`. The report, the summary and every chart are rebuilt from the
recorded runs and match the committed files. Read [`packages/sim/results/2026-11-12/REPORT.md`](packages/sim/results/2026-11-12/REPORT.md):
six scenarios with ending capital, claims paid and unpaid, solvency ratio, maximum drawdown, probability of
insolvency and time to insolvency; every input assumption, with `P(event)` named an underwriting assumption;
the scenario that breaks the pool, shown as it is (a pool with 100 NEAR and no rules goes unpaid in 99% of runs);
and the derived concentration limit. To regenerate everything from nothing (about 3 minutes):
`pnpm --filter @aruna/sim sim --date 2026-11-12`. The model's rules are checked against the real pool:
`cargo test -p aruna-pool golden` (in `contracts/`) and `pnpm --filter @aruna/sim test`. Nothing here is
measured: how often contracts really change is still open (`docs/DECISIONS.md`, question 1).

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
coverage layer, running on testnet (step 12), adds two:

1. **The attestor.** Detecting that code changed needs an off-chain observer; five on-chain routes
   were tested and are closed (`docs/NEAR-FACTS.md` §1). The registry checks a report's signature,
   bond, expiry, nonce, that the two resolved hashes differ, and that the claimed block lies within
   the lookback bound. It cannot check that the claimed block is true.
2. **The arbiter.** Disputed drift reports are resolved by a designated account.

Both are run by Aruna on testnet, openly. A report freezes the target as soon as it is accepted,
before its challenge window closes: with one attestor, one party can freeze any covered target at
any time, bounded only by its bond and the arbiter's slashing. That is deliberate, so agents stop
spending into a target whose code changed (`docs/DECISIONS.md` D-59).

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
| `@aruna/classifier-core`, `@aruna/rpc`, `@aruna/cli` | a hosted indexer, and console history read from it |
| console: wallet, transaction preview, create a vault, agents and policy, run an agent, overview, policy price (steps 5c to 5f) | console coverage, claims, pool and targets on chain data; console history from the indexer (step 5g) |
| `@aruna/indexer`: testnet events into SQLite behind a read API, runnable yourself ([`packages/indexer`](packages/indexer/README.md)) | |
| coverage on testnet: pool, registry drift path, attestor, vault v3 (step 12) | pool simulation, and `k` and the concentration limit derived from it |
| live classifier page (`apps/web`) | migration tooling between vault versions |
| keyless MCP tools, `@aruna/sdk` `Classifier` and `readVault` | an attestor independent of Aruna |
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
packages/sdk               Classifier (check, watch), readVault, vault role clients, coverage clients and quote, ABI-generated types
packages/mcp               MCP server: aruna_check_target, aruna_watch_target, aruna_explain_class, aruna_read_vault, coverage reads, agent tools
packages/attestor          drift attestor: watches targets, files signed reports and heartbeats
packages/indexer           testnet aruna events into SQLite, served over a read-only HTTP API
packages/sim               empty in v0: the pool simulation follows
contracts/                 vault, registry, factory, pool, common; integration tests on a sandbox
apps/web                   static classifier page, spec, proof and console (live: lookup, create a vault, agents)
fixtures/                  one testnet account per class, the drift demo
examples/                  an honest and a prompt-injected agent against the testnet vault
measurement/               BigQuery query, raw export, results, report
lab/                       sandbox protocol evidence (T0–T9)
docs/                      architecture, decisions, protocol facts
```

## Credits

Built with Claude Code (Anthropic) as a coding agent; AI-generated code is reviewed and tested as
described above. Libraries: `@modelcontextprotocol/sdk`, `zod`, `vitest`, `typescript`, Next.js,
React, Tailwind CSS, Radix UI, Phosphor Icons, Framer Motion, Sonner, `near-api-js` and
`@hot-labs/near-connect` (web), `near-sdk`, `near-primitives`, `near-sandbox` (contracts and lab), `near-cli-rs`
(fixtures). Data: the NEAR public BigQuery dataset.

MIT License.
