# Build plan, release gates and cut points

Aruna is a product. The hackathon deadline, **14 November 2026, 23:59 UTC**, is the date of
public release **v0**, not the finish line. Cut points are chosen so stopping anywhere still
leaves something whole.

**The order is classifier-first, and that is the point.** The first paying customer is an
agent-as-a-service company, and it buys the vault and the public page. The classifier is
what makes those worth buying rather than a sixth spending guard, so it comes first and the
vault consumes it.

Never start a stage before the previous one's acceptance criteria are green.

---

## Release v0 — target 14 November

Stages 0, 1 and 2 are committed. Stage 3 is a deliberately thin vault with its public page,
on testnet, if time allows. Everything else follows v0.

### Status (12 November 2026)

| Stage | Status | Evidence |
|---|---|---|
| 0 Lab debt | Done | `lab/owed`, `NEAR-FACTS.md` §10; README step 8 |
| 1 Classifier | Done | `classifier-core` 47 tests, zero dependencies; README steps 2–3 |
| 2 Measurement and page | Done | `measurement/REPORT.md`, `pnpm measure`; README steps 4, 5, 7 |
| 3 Thin vault and public page | Done on testnet | vault v2 on `demo2.factory.arunafi.testnet` self-classifies `immutable_verified`; 5 sandbox integration tests; README steps 5b, 9–11 |
| 4 SDK and MCP | Done | `sdk` 70 and `mcp` 22 tests, ABI-generated types with a drift test; README steps 6, 13 |
| 5 Exposure, indexer, console | Partly done | `exposure_before` in vault v3; a failed callback releases its reservation (step 10); `@aruna/indexer` built and tested (70) but not hosted; console lanes L0–L5 live (wallet, preview, create a vault, agents, running the two agents from the Playground, the Overview and the policy price); the history half of L5 (activity and exposure rows from the indexer) is not met because the hosted indexer stopped about 370,000 blocks behind on 12 November. `class_at_record` keeps only the latest class per target (`AUDIT-v0.md` I1) |
| 6 Migration | Not started | planned after v0: U14–U16 in `plans/2026-11-11-1645-…` |
| 7 Coverage on testnet | Done on testnet | see the status under stage 7; README step 12 |
| 8 Simulation | Done; console screen owed | `@aruna/sim`: five scenarios plus a labelled counterfactual, golden vectors from the real pool, `pnpm --filter @aruna/sim sim` regenerates every result and chart from `raw/`, published in `packages/sim/results/2026-11-12/`; derived values in D-66 (concentration 1.4 x, `k` not identified at the declared P(event)) and not locked, as gate B requires measured drift frequency. Owed: the console's Simulation screen still runs its in-browser prototype (U18, lane B) |

**Out of order.** Stage 7 was built before stages 5 and 6 were green, against the rule above.
It runs on testnet only and holds no real value, so no gate is affected, but stage 5's
remaining criteria and stage 6 are still owed before gate A.

**Console live spend: unblocked 12 November.** `registry2.arunafi.testnet` had no class for
`swap.arunafi.testnet`, so a console-created vault could list only the frozen
`drift-target.arunafi.testnet`. It was classified `local_upgradeable` on 12 November 2026 (tx
`EFuXBSrLsKCWXaTpf1xt7Wkzu554URHroJDj5WwbnTaX`, `target_classified` event), which unblocks L4.
A vault's agent still pulls it with `refresh_class` before its first spend.

## Stage 0 — Lab debt

Before any product code. T5–T9 (`TESTING.md`) can invalidate later work: the lab tested gas
keys on sub-accounts, and the product uses classic function-call keys on a contract account.

**Acceptance:** T5–T9 recorded in `NEAR-FACTS.md` with exact errors, and the compiled-import
comparison from T7 repeated with `cargo near build`.

## Stage 1 — `classifier-core`, `rpc`, `cli`

The dependency-free engine, the RPC readers and a batch runner. No contracts, no accounts,
no transactions.

**Acceptance**
- `classify(accountId, rpc)` returns class, `mutabilityBasis` and full evidence for an
  arbitrary account
- four fixtures, one per class, classified correctly, plus every case in `TESTING.md`
- unparseable WASM → `unknown`, never a guess
- an account with no contract is not confused with a global-contract account
- `npm ls` shows `classifier-core` has zero dependencies

**Cut point:** a library anyone can use to answer "can this contract still change?"

## Stage 2 — The measurement and the classifier page (`apps/web`)

Run the CLI across the top N most-called mainnet contracts, read-only, and publish the
result. Build the static page: paste an account id, see its class and evidence, computed
live from public RPC in the tab. No wallet, no backend, no install.

**Data source:** the NEAR BigQuery public dataset, filtered on `block_date`, with the query
in the repo. It needs the owner's Google Cloud credentials.

**Acceptance**
- a class distribution table with source, query and date
- import-only accounts counted separately from those holding a full-access key
- both headlines from `CLASSIFIER.md` computed; the framing chosen after seeing the numbers
- one command regenerates the measurement from raw data
- the page runs from a plain static host, confirmed against public RPC from a browser origin
- a `global_by_account` example shows the monitored field and the resolved hash side by
  side, and says plainly which is wrong

**Cut point — the most important one.** Even if nothing else ships, this is a finding with
evidence, experienceable in ten seconds, that none of the five surveyed projects has.

## Stage 3 — Thin vault and the public agent page

`contracts/common`, a minimal `registry`, `factory`, `vault` and one adapter, on testnet.
One vault per client, with the client as owner and the AaaS company as operator.

**Acceptance**
- the compiled vault imports none of the scanned host functions
- a factory-deployed vault classifies as `immutable_verified` under our own classifier,
  with evidence published
- only authorized classifiers can write a class
- the operator can add agents within the client's ceiling, pause, and tighten; it cannot
  loosen a limit, resume an auto-disabled agent, change the owner or withdraw
- swap proceeds return to the vault; an adapter cannot pay anyone else
- `view_access_key_list(vault)` shows the whole fleet with exact permissions, in one call
- every `cb_` method is rejected for an agent key with `MethodNameMismatch`
- two parallel requests jointly exceeding the daily cap: exactly one passes
- a stale cached class returns `ARUNA_CLASS_STALE`; a refresh clears it
- a revoked agent's transaction is rejected by the **network**, never executed
- refusals **return** and persist their event; agent-caused ones increment the counter
- the public agent page works with no login

**Cut point:** classification made actionable, and something an AaaS company can show a
client.

## Stage 4 — `sdk`, `mcp`

The typed client, ABI-generated types in the build, the keyless classifier tools, then the
vault tools.

**Acceptance**
- `Classifier` client works with no account
- `aruna_check_target` answers for any mainnet or testnet account, with no registration
- generated types are in the build; a deliberate contract signature change breaks it
- reason codes in the SDK and the contract are asserted identical

## Stage 5 — Exposure, `indexer`, the console (`apps/web/console`)

Exposure checkpoints, chain events into a database, and the owner and operator dashboards
with the policy-to-price panel.

**Acceptance**
- exposure readable through a view method, including exposure before a given block
- a failed callback releases the reservation and records nothing
- each exposure row carries the class at the time it was recorded
- the indexer reconstructs activity and exposure history from events alone

## Stage 6 — Migration

Required before any mainnet vault: immutable vaults can never be patched.

**Acceptance**
- CLI command and console flow move funds and agents to a new vault version
- the registry maps a code hash to affected vaults and owners
- the SDK supports more than one vault version and refuses unknown code hashes loudly

## Stage 7 — `pool`, coverage, claims, `attestor`, on testnet

**Acceptance**
- coverage purchased by the owner; waiting period enforced; premium enters the pool
- capital adequacy and concentration enforced **at purchase**, by the pool
- a drift report freezes the target across subscribed vaults, and a vault the push misses
  learns of it within the staleness bound
- **no payout before the challenge window closes**; a disputed report blocks payout
- `changed_at_block` outside the lookback bound is rejected, and so is a report whose two
  resolved hashes match
- payout = `min(exposure before the claimed block × ratio, limit)`, arithmetic visible
- the pool accepts exposure only from factory-registered vaults
- attestation tests: forged, expired, replayed, swapped, and outside the lookback bound
- a stale heartbeat from a target's assigned attestor blocks new coverage on that target
- the README states both trust assumptions: attestor and arbiter

**Status (11 November 2026).** Built and passing on a sandbox: `contracts/integration/tests/coverage.rs`
(NEAR and USDC loops, dispute upheld and rejected, stale heartbeat) and the unit tests in
`contracts/registry` (forged, expired, replayed, swapped, lookback, identical hashes) and
`contracts/pool` (adequacy, concentration, payout arithmetic, loosening, allowed vaults). Live on
testnet with `examples/coverage-demo.ts`. Plan: `docs/plans/2026-11-10-2106-feat-coverage-loop-testnet-plan.md`.

## Stage 8 — `sim`

200 agents over 60 days. Normal operation, one target changes, mass correlated claims,
underwriter withdrawal, insufficient capital.

**Acceptance**
- every input assumption shown explicitly, `P(event)` named as an underwriting assumption
- outputs: ending capital, claims paid and unpaid, solvency ratio, maximum drawdown,
  probability of insolvency, time to insolvency
- **one scenario that breaks the pool, shown as it is**
- one command rebuilds every chart from raw data
- the derived values for `k` and the concentration limit are written back into
  `DECISIONS.md`

---

## Release gates

**Gate A — a vault holds real funds on mainnet.** All of:
- T5–T9 passed on testnet, and gas costs measured there
- an independent third-party security audit
- migration tooling shipped (stage 6)
- a TVL cap per vault
- one or two AaaS pilot customers, on capped vaults

**Gate B — coverage sold on mainnet.** Gate A, and all of:
- drift frequency measured on mainnet history (open question 1)
- `k` and the concentration limit derived from the simulation and locked
- at least one attestor independent of Aruna
- legal review of whether the product counts as regulated insurance where it is sold

Coverage runs in full on testnet with its numbers labelled as assumptions until then.

## Also on the map

**A NEP for mutability class.** The `global_by_account` problem is not Aruna's: it affects
every indexer, risk dashboard and agent on NEAR. Solving it at the standard level is the part
of this work most likely to outlive the product.

---

## Submission checklist for v0

- [x] Public repo, MIT LICENSE, no keys in git history (repo public with MIT on GitHub; on
  12 November every branch's history was searched for `ed25519:` private keys, `secret_key` and
  `private_key`, and no tracked `.env`, with no match. A pattern search, not a secret scanner)
- [x] README with numbered "do X, see Y" steps, each with an expected result
- [x] First screen carries the positioning sentence from `COMPETITIVE.md`
- [ ] Demo post on X tagging @NEARProtocol and #NEARHackathon, with video or screenshots
- [ ] A mainnet NEAR account for the payout
- [x] Project description, 20–2,000 characters (`docs/SUBMISSION.md`)
- [ ] Every fitting track selected — `security`, `agents`, `defi`, `open`
- [ ] Submitted before 14 November 23:59 UTC

Code from 19 October 2026 counts as the build; earlier commits are baseline. Libraries and
AI-generated code are allowed if named in the README.
