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

Requirements: Node 22.13+, pnpm 9 (`corepack enable`). The indexer's tests need no database: they run on an in-process Postgres.
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

On Windows, `pnpm -r test` stops at a test that depends on the platform: `sdk` `abi-drift` fails if git
checked the files out with CRLF line endings (`git config core.autocrlf false`, then check out again, and it
passes). `pnpm -r --no-bail test` runs the rest.

Expected: every package builds; tests pass in `classifier-core` (47), `rpc` (32, 3 live tests
 skipped), `cli` (28), `attestor` (38), `keeper` (29), `sdk` (110), `mcp` (22), `indexer` (158, 8 skipped), `sim` (36) and `apps/web` (329).

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

The same build is published at https://www.arunafi.xyz/ (also https://aruna-dun.vercel.app). Every step in 5 to 5f works there by replacing `http://localhost:4173` with that address; it is built without an indexer URL, so step 5g applies to it too.

```bash
pnpm --filter @aruna/web build
python3 -m http.server 4173 --directory apps/web/out
```

Open `http://localhost:4173`, click `fx-guser.arunafi.testnet`. Expected: "Can change silently", with the
technical class `global_by_account` beside it, and a side-by-side table: `view_account.code_hash` marked wrong, `view_code.hash`
marked as the code that runs. The tab reads public RPC directly — no backend, no wallet. Switch
the selector to mainnet and type `wrap.near` for a mainnet read.

### 5b. The console and the public agent page

With the static host from step 5 still running, open `http://localhost:4173/console/lookup/`. It reads
`demo2.factory.arunafi.testnet` live through `@aruna/sdk` `readVault`, with no login. Expected: owner
`demo-client.arunafi.testnet`, operator `demo-company.arunafi.testnet`, `0` full-access keys, and a list
of agents. Click an agent. Expected: a page listing what its key cannot do, its limits and usage, and a
`curl` for `view_access_key_list` whose output you can compare by hand.

Which console screens read the chain: Lookup and the public agent page (this step), Create a vault,
Agents and agent detail (step 5d), the Playground (step 5e), the Overview (step 5f), and Coverage, Buy
coverage and Claims (step 5h), Simulation (step 5i, the published results of `packages/sim`) Pool (step 5j, read-only) and Targets with its detail page
(step 5k) and Attestors (step 5l). Migration checks a plan from the SDK (step 14). Only the Guided demo, a scripted walkthrough, runs on sample data in v0. Treat the numbers on those screens as illustrations, not results; the
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
include it (the wizard's Contracts step), and about 0.5 NEAR in the vault. The agent's key must be in this
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
active agents and the amount sent through the vault, a table of your agents, and the contracts they touch with the
exposure recorded to each and its risk when last sent to (for example "Upgradeable by owner"; hover for the technical class). Exposure is what was sent through the vault, not the value of a
position. These numbers come from `readVault`; they do not depend on the indexer.

Then open an agent (`Agents`, click its name), the **Limits** tab, and the panel **What these limits cost**. It
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

### 5g. History from the indexer

The Activity tab and the Overview list refusals and exposure rows from `@aruna/indexer`, with the reason, the class at refusal
and a transaction link. The site at `https://www.arunafi.xyz` is built with `NEXT_PUBLIC_INDEXER_URL` set to the hosted
indexer, `https://aruna-near-indexer.up.railway.app`, so these panels read it. A build without that variable says "History is
not connected in this build" instead of showing data.

1. Check the hosted indexer:

```bash
curl -s https://aruna-near-indexer.up.railway.app/health
curl -s 'https://aruna-near-indexer.up.railway.app/v1/coverages?pool=pool2.arunafi.testnet&limit=100'
```

   Expected on 13 November 2026: `"healthy":true`, `"mode":"following"` and `"lag_blocks":0` (it had been about 370,000 blocks behind
   earlier that day); coverages 0 to 5 on `pool2`, with #4 active on
   `drift-target.arunafi.testnet` and #5 active on `swap.arunafi.testnet`.
2. To run the indexer yourself, see [`packages/indexer`](packages/indexer/README.md); a backfill takes hours. Rebuild `apps/web`
   with `NEXT_PUBLIC_INDEXER_URL=<your indexer>` to read it.

### 5h. Coverage and claims, read from the pool

These three screens read the pool (`pool2.arunafi.testnet`) and the registry (`registry2.arunafi.testnet`) directly. The
vault below is `demo4.factory2.arunafi.testnet`, which the coverage demo in step 13 bought coverage on. To run it from your
own build, replace `https://www.arunafi.xyz` with `http://localhost:4173`.

1. Open `https://www.arunafi.xyz/console/coverage/?vault=demo4.factory2.arunafi.testnet`. Expected: four coverages on
   `drift-target.arunafi.testnet` (#0 and #1 Ended, #2 and #3 Paid), amounts as the pool holds them, and "Paid out 0.08 NEAR"
   on #2. The token coverages show their amount in the token's smallest unit.
2. Open `https://www.arunafi.xyz/console/claims/?vault=demo4.factory2.arunafi.testnet`. Expected: drift report 2 on
   `drift-target.arunafi.testnet`, state `verified`; two claim rows for coverage #2 (the first "challenge window still open"
   with 0 paid, the second "paid" with 0.08 NEAR) whose formula column ends `= 0.08 NEAR`.
   Click report `2`. Expected: the report page with a timeline (drift_reported, challenge_window closed, claims_open),
   the attestor `attestor-a.arunafi.testnet`, changed at block 277,193,145, both resolved code hashes, and a
   `get_report` command, under "Verify without this page", that prints the same record.
3. Check the same numbers on chain, without the page:

```bash
node fixtures/tools.mjs view pool2.arunafi.testnet get_coverage '{"id":2}'
node fixtures/tools.mjs view registry2.arunafi.testnet latest_report '{"target":"drift-target.arunafi.testnet"}'
node fixtures/tools.mjs view registry2.arunafi.testnet get_report '{"id":2}'
node fixtures/tools.mjs view demo4.factory2.arunafi.testnet exposure_before '{"agent":"ed25519:EcTZ2jgMfgrnYvD8pJPHPi349waY2jPbwqEPnhujx3FR","target":"drift-target.arunafi.testnet","token":"near","block":277193145}'
node fixtures/tools.mjs view demo4.factory2.arunafi.testnet exposure_before '{"agent":"ed25519:EcTZ2jgMfgrnYvD8pJPHPi349waY2jPbwqEPnhujx3FR","target":"drift-target.arunafi.testnet","token":"near","block":277193101}'
```

   Expected: `"paid_out":"80000000000000000000000"` with a claim `"outcome":"paid"`; the report in state `verified` with
   `changed_at_block` 277193145; exposure `"100000000000000000000000"` at the changed block and `"0"` at the purchase block.
   The pool pays `min(100000000000000000000000 x 8000 / 10000, 1000000000000000000000000)` = 80000000000000000000000.
4. Open `https://www.arunafi.xyz/console/coverage/buy/?vault=l2ocbae.factory2.arunafi.testnet` with the vault's owner
   connected. Expected: a price from the pool for the chosen agent and target and, while the target's assigned attestor has no
   fresh heartbeat, the message "has not sent a fresh heartbeat" with **Buy this coverage** off. Check the heartbeat:

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet heartbeat_fresh '{"target":"drift-target.arunafi.testnet"}'
```

   Expected on 13 November 2026: `false` until the hosted attestor started that afternoon (step 16), then `true`, and the button
   is on.

A purchase has been made since: coverage #5 on `swap.arunafi.testnet` (30 days, limit 1 NEAR, premium 0.0723 NEAR). Two
earlier attempts were each refused by the pool with a `coverage_refused` event: one for an agent whose `max_risk_class`
(`immutable_verified`) is below the target's class (`local_upgradeable`), one for a window of 47 days, above the 30-day
maximum. Not met in v0: a claim sent from the console. The claim button is shown only when a verified report has no paid claim,
and none has been sent from the console. Only NEAR coverage can be bought from the console; token coverage is shown but not
bought. Two points in the pool's claim code are under review and not yet confirmed (`docs/FOR-ARIS.md`, item 7).

### 5i. Simulation, read from the published results

1. Open `https://www.arunafi.xyz/console/simulation/`. Expected: one table with six scenarios as columns and six measures as rows,
   from `packages/sim/results/2026-11-12/`; `P(event)` named an underwriting assumption, not a measurement; "Capital not enough"
   set apart as the scenario that breaks the pool (98.8% of runs insolvent, time to insolvency 30.3 days); the solvent scenarios
   reading "not insolvent within 60 days".
2. Check that the page and the results agree:

```bash
pnpm --filter "@aruna/web" exec vitest run src/console/data/simulation-published.test.ts
```

   Expected: 4 tests passed. The test re-derives the page's data from `summary.json` in the results folder. To refresh the page
   after a new run: `node apps/web/scripts/sync-simulation.mjs packages/sim/results/<date>`.

### 5j. Pool, read from the contract

1. Open `https://www.arunafi.xyz/console/pool/`. Expected: a "NEAR book" read from `pool2.arunafi.testnet` with capital, limits on
   the book against k x capital, whether withdrawals are locked and until which block, coverage counts (active, ended and not yet released, paid), and a table of coverage
   by code hash or upgrade authority against the cap of 2 x capital per group. Connect a wallet to see your share of each book, as a percentage.
2. Check the book without the page:

```bash
node fixtures/tools.mjs view pool2.arunafi.testnet get_book '{"token":"near"}'
```

   Expected: `capital`, `total_limits` and `locked_until` equal the tiles on the page. Adding and withdrawing capital are not in
   the console in v0.

### 5k. Targets, read from the registry

1. Open `https://www.arunafi.xyz/console/targets/`. Expected: a table of the seeded targets and every target the pool has
   covered, from `registry2.arunafi.testnet`: `drift-target.arunafi.testnet` recorded "Can change silently" (`global_by_account`, in the tooltip), attestor
   `attestor-a.arunafi.testnet` with its heartbeat state, not frozen once the keeper has released it after report 2 (it was frozen
   from that report until 13 November 2026); `swap.arunafi.testnet` recorded "Upgradeable by owner" (`local_upgradeable`), with the same attestor assigned.
2. Open `https://www.arunafi.xyz/console/targets/detail/?id=drift-target.arunafi.testnet`. Expected: the registry's record
   (class, block, classifier, evidence hash, resolved code hash, upgrade authority) beside a fresh run of
   `@aruna/classifier-core` over public RPC, a sentence saying whether the two classes agree, and the latest drift report.
3. Check the record without the page:

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet get_class '{"target":"drift-target.arunafi.testnet"}'
```

   Expected on 13 November 2026, after the keeper ran (step 16): `"class":"global_by_account"`, `"frozen":false`,
   `"upgrade_authority":"drift-owner.arunafi.testnet"`, matching the page. Before the keeper it read `"frozen":true`. The registry has no view that lists its targets, so the list is the seeded targets plus the pool's covered ones; any
   other target is opened by name.

### 5l. Attestors, read from the registry

1. Open `https://www.arunafi.xyz/console/attestor/`. Expected: `attestor-a.arunafi.testnet` with its bond (1 NEAR), the block of
   its last heartbeat and how many blocks ago that was, "Heartbeat stale" while it is more than 600 blocks, and the targets it
   watches (`drift-target.arunafi.testnet` and `swap.arunafi.testnet`) with their recorded class and latest report. A target
   with no attestor assigned is listed in a notice instead.
2. Check the record without the page:

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet get_attestor '{"attestor":"attestor-a.arunafi.testnet"}'
node fixtures/tools.mjs view registry2.arunafi.testnet heartbeat_fresh '{"target":"drift-target.arunafi.testnet"}'
```

   Expected with the hosted attestor running (step 16): `bond` `1000000000000000000000000`, `last_heartbeat` equal to the block on
   the page (it moves about every 3 minutes), and `true`; `false` once the heartbeat is more than 600 blocks old. Heartbeats and drift reports are sent from the attestor's own account; the console only reads.

### 5m. Finding your vault

The console finds the vaults an account owns from the registry, not from the indexer.

1. Connect a wallet at `https://www.arunafi.xyz/console/create/`. Expected: "Your vaults" lists every vault the account owns,
   newest first, including one made a minute ago.
2. Open `https://www.arunafi.xyz/console/dashboard/` with no `?vault=` and with the wallet connected. Expected: the account's
   newest vault opens. With no wallet connected: "No vault is selected" and "Connect a wallet to see the vaults it owns."
3. Disconnect. Expected: the vault the browser remembered is forgotten, so the Overview no longer shows it.
4. Check the list without the page. The registry lists the vaults that run a code hash, with the owner at registration:

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet vaults_by_code_hash '{"code_hash":"6fqp3des9ZNAdV3NfAWz8RDrXsqDnpRwqJ4BJAqzuFEh","from":null,"limit":null}'
```

   Expected: each vault with its `owner`, as the page shows. On the Overview, the "Vault" tile names the current vault and, when the account has more than one, gets a
   "Switch vault" button on the right; pressing it shows the vault list, and choosing one reloads the screen for that vault (`?vault=` in the address). The Lookup page offers the connected account's vaults under "Yours". Limits: the owner is the one recorded at registration, and a vault an
   account only operates is not recorded, so those still come from the indexer.

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

### 14. Move a vault to the current version

Vaults are immutable, so a new version is a new vault. A vault made by the v0 factory (vault v2) was
moved to the current version on 12 November 2026 with `aruna migrate`. Read the result, no key needed:

```bash
node packages/cli/dist/index.js classify mig1.factory2.arunafi.testnet --network testnet
node fixtures/tools.mjs view mig1.factory2.arunafi.testnet get_agents
node fixtures/tools.mjs view mig1.factory.arunafi.testnet get_agents
```

Expected: the new vault is `immutable_verified` with `"fullAccessKeyCount": 0`, `"functionCallKeyCount": 2` and
resolved code hash `6fqp3des9ZNAdV3NfAWz8RDrXsqDnpRwqJ4BJAqzuFEh`; it holds the agents `trader` (`Active`) and
`injected` (`Paused`), with the same public keys and limits as before; the old vault lists both as `Revoked`,
has no access key, and keeps about 0.0138 NEAR for its storage. `registry2` lists the new vault under that hash:

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet vaults_by_code_hash '{"code_hash":"6fqp3des9ZNAdV3NfAWz8RDrXsqDnpRwqJ4BJAqzuFEh","from":null,"limit":null}'
```

To move a vault of your own (testnet, and you must be its owner, with its key saved by near-cli-rs
`save-to-legacy-keychain`; the key is never taken from an argument):

```bash
node packages/cli/dist/index.js migrate <old-vault> --name <new-name> --factory factory2.arunafi.testnet --as <owner> --dry-run
node packages/cli/dist/index.js migrate <old-vault> --name <new-name> --factory factory2.arunafi.testnet --as <owner>
```

The console checks the same plan without signing anything. Open
`https://www.arunafi.xyz/console/migrate/?vault=mig1.factory.arunafi.testnet`, connect a wallet and press **Check the plan**.
Expected with a wallet that is not the owner (`mig-owner.arunafi.testnet`): "The plan was refused. Nothing was sent." naming
the owner. On `l2ocbae.factory2.arunafi.testnet`: refused because it already runs v4, the version the factory makes. With the
owner connected the page shows the coverage warning first, then the agents carried, the funds and the two commands. The
migration itself is sent from the CLI.

Expected: the dry run prints the agents carried (each with its state), the funds to move and a warning if
coverage stays behind, and signs nothing. The real run asks before each transaction, then prints each
transaction hash. Run the same command again: every step prints `skipped` and nothing is sent. What the move
does not carry: active coverage (it stays with the old vault), each agent's daily usage and recorded
exposure. Test USDC and other tokens move too (sandbox: `contracts/integration/tests/migrate.rs`); the testnet
run above moved NEAR only. Decision: `docs/DECISIONS.md` D-65.

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

### 16. Are the attestor and the keeper alive?

Both run on Railway (`docs/DEPLOY-ATTESTOR-KEEPER-RAILWAY.md`). Check them from chain state:

```bash
node fixtures/tools.mjs view registry2.arunafi.testnet heartbeat_fresh '{"target":"swap.arunafi.testnet"}'
node fixtures/tools.mjs view registry2.arunafi.testnet heartbeat_fresh '{"target":"drift-target.arunafi.testnet"}'
node fixtures/tools.mjs view registry2.arunafi.testnet get_class '{"target":"drift-target.arunafi.testnet"}'
node fixtures/tools.mjs view pool2.arunafi.testnet get_coverage '{"id":5}'
```

No key needed. Expected with both services running, as on 13 November 2026: `true`, `true`, a class record with
`"frozen":false` (the keeper lifted the freeze that report 2 had left since the demo run, then wrote the class again), and
coverage 5 on `swap.arunafi.testnet` with `"premium_paid":"72333333333333333333332"` and `"end_block":278832453`. Without the
attestor, `heartbeat_fresh` reads `false` once its last heartbeat is more than 600 blocks old (on 13 November 2026, before it
ran, it did, for `drift-target`). The rules of both services run against a fake registry, with no key and no network:
`pnpm --filter @aruna/attestor --filter @aruna/keeper test`.

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

A third piece of Aruna's own automation is not a trust assumption but is worth naming: a keeper
(`packages/keeper`) that, once a drift report is final, re-classifies the target and lifts its freeze when the new
class is no riskier, or leaves it for a person when it is riskier. It acts as the registry owner through a
function-call key limited to `set_class`, `lift_freeze` and `push_freeze` (open to anyone), and the key can record any target as any class
(`docs/DECISIONS.md` D-67). It is Aruna's, run by Aruna, and not independent of it.

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
| `@aruna/classifier-core`, `@aruna/rpc`, `@aruna/cli` | |
| console: wallet, transaction preview, create a vault, agents and policy, run an agent, overview, policy price; coverage, claims, pool, targets, attestors, simulation and the migration plan read from the chain or the published results (steps 5c to 5m) | a claim sent from the console (step 5h); a migration sent from the console, which is the CLI's (step 14); adding or withdrawing pool capital in the console |
| `@aruna/indexer`: testnet events into Postgres behind a read API, hosted at `aruna-near-indexer.up.railway.app` and read by the console (step 5g) | |
| coverage on testnet: pool, registry drift path, vault v3 (step 12); the attestor and the keeper as hosted services, with coverage bought on `swap` (step 16) | `k` and the concentration limit locked: derived by the simulation (D-66) but not locked until drift frequency is measured |
| live classifier page (`apps/web`) | |
| keyless MCP tools, `@aruna/sdk` `Classifier` and `readVault` | an attestor independent of Aruna |
| mainnet measurement with raw data and query | mainnet anything that holds funds |
| testnet fixtures and the drift demo; `aruna migrate`, resumable (step 14); the pool simulation, published (step 15) | an alert when a hosted service stops; the keeper's and the attestor's gas measured over a long run |
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
packages/attestor          drift attestor: follows the registry's assignments, files signed reports and heartbeats
packages/keeper            freeze keeper: after a final report, re-classifies and lifts the freeze when the class is no riskier
packages/indexer           testnet aruna events into Postgres, served over a read-only HTTP API
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
