# Locked decisions

If a design choice feels worth debating, it is probably settled here. Do not reopen one
without new evidence. Several reverse earlier decisions after testing or review proved
them wrong; that history is kept deliberately, because the reasons still apply.

---

## Product shape

### D-01 — The classifier is the differentiator and is built first
Five comparable hackathon projects already shipped vault-plus-scoped-key spending
guards, some with more tests than we will write. Building that as the product means
being one of five. Build order is classifier-first. See `COMPETITIVE.md`. The first customer
buys the vault and public page (D-36); the classifier is why those are worth buying.
*Supersedes an earlier plan that built isolation and the gate first.*

### D-02 — Agents are function-call keys on the vault, not sub-accounts
Cheaper (no account creation or storage stake), stronger revocation (`delete_key` is
refused by the network, not by contract logic), and one `view_access_key_list(vault)`
call shows the whole fleet. It also removes gas keys entirely — classic `allowance`
paid from the vault's balance, no NEP-611, no TransactionV1, no patchy library support.
Identity is `signer_account_pk()`, with a human-readable label in state.
*Adopted from a comparable project. Supersedes sub-accounts plus gas keys.*

### D-03 — `method_names` is load-bearing security
An agent's call satisfies `predecessor_account_id() == current_account_id()`, the usual
guard for private callbacks. Only the key's method list stops an agent reaching one.
Callbacks are prefixed `cb_`; tests enforce that no `cb_` name appears in any agent key
and that every callback rejects an agent key.

### D-04 — The risk tier is encoded in the key's method list
Agents permitted only `immutable_verified` targets get a different method set. Part of
the policy is enforced by the protocol, not only the contract.

### D-05 — Three contracts, not one. *Supersedes the single-contract decision.*
A per-owner vault cannot hold a shared underwriter pool, cross-owner concentration
limits, or a freeze beyond its own agents. Split into `vault` (per owner, hot path),
`registry` and `pool` (shared, cold paths), which may start in one account as separate
modules. The original reason for one contract —
atomic per-transaction accounting — still holds, and the whole `spend` path stays
inside the vault.

### D-06 — The vault holds no full-access key
A vault whose owner holds one classifies as `local_upgradeable` under our own
classifier, collapsing the headline claim. Owner authority lives in state; agent keys
are managed by the contract itself, through low-level promise functions (D-41). *Corrects a direct contradiction in an
earlier architecture.*

### D-07 — The vault is a named-action gateway, never a generic executor
A free-form `execute(target, method, args)` turns it into a proxy that can call
anything. *Cost accepted:* one hand-written adapter per protocol, so fewer protocols
supported than competitors.

---

## Classification

### D-08 — Immutability requires no **full-access** keys, not no keys
Function-call keys cannot perform account actions, so they cannot re-point or replace
code. *Corrects an earlier spec requiring an empty key list, which would have
disqualified our own vault.* Lab test T5 owed.

### D-09 — Immutability needs three checks
By hash, no full-access keys, clean import section. "No full-access key" alone is not
enough; a locked contract can still upgrade itself.
*Reverses an early `upgrade_factor` using key presence as a proxy, which would have
priced the highest-risk category at nearly zero.*

### D-10 — The scan includes delete-account and full-access gas keys
A contract that can delete its own account frees the name, and a parent can recreate a
sub-account with different code. Until lab test T9 confirms the behaviour, describe
`immutable_verified` as "no detected upgrade path under these checks", not as an
unqualified proof. `promise_batch_action_add_gas_key_with_full_access` hands control to a key
like the ordinary form does, so it is scanned too.

### D-11 — The classifier core has zero dependencies
Account id plus an injected `RpcReader`. That is what lets one engine serve the browser
page, the CLI, the MCP server and the attestor. A dependency breaks four consumers.

### D-12 — Only authorized classifiers may write a class
Specified and enforced in the registry. An open write path makes every downstream
decision meaningless.

### D-13 — Drift monitoring uses four channels
`view_account.code_hash` is blind to `global_by_account` changes, proven in the lab.
Add `view_code` polling, `DeployContract` and `UseGlobalContract` on the target, and
`DeployGlobalContract` on the owner account.

### D-14 — `unknown` is never insurable
Pricing what you cannot determine is the fastest way to lose underwriters and buyers.

---

## Execution semantics

### D-15 — Policy refusals return; authorization failures panic
A panic reverts state, so a refusal that panics cannot increment a counter, write a log
or emit an event — making auto-disable impossible. *Corrects an earlier flow that
specified both a panic and a counter increment.*

### D-16 — Reservation accounting is mandatory
Asynchronous receipts mean `spent_today` has not increased when the next check runs.
The check is `spent + reserved + requested ≤ cap`, and its test must be **parallel**.

### D-17 — Target class is re-validated at execution against the last recorded value
Not at policy-set time, and not live — no contract can read another's state. State it
with that precision.
*Adapted from a competitor's re-checking of queued approvals; applied at the gate.*

### D-18 — Class freshness is pull-with-staleness-bound, plus push for freezes
Pushing every update to every vault is O(n) and breaks at scale. Freezes push because
they are urgent and rare; routine updates are pulled when the cache exceeds
`MAX_CLASS_AGE`, with the SDK absorbing the refresh. *Supersedes push-only.*

### D-19 — Auto-disable is risk-weighted, and counts only agent-caused refusals
Refusals against `global_by_account` or `unknown` count more than against
`immutable_verified`. An injected agent produces a burst, so the refusal log becomes an
active defence. Only works because refusals return rather than panic. Frozen, stale,
reclassified and unfunded refusals do not count, or one freeze would disable honest agents
in every vault.

### D-20 — Funds are custodied by the vault; agents never hold tokens
Not a choice. Restricted keys cannot attach a deposit and NEP-141 requires 1 yoctoNEAR.
`withdraw_to_owner` is owner-only and sends only to the registered owner.

---

## Coverage

### D-21 — Coverage is parametric, not indemnity
A contract cannot prove actual loss. Payout is recorded exposure × ratio, capped. No
judgement about whether an upgrade was malicious.
*Cost accepted:* benign upgrades trigger payouts too. Whether that is survivable is
open question 1.

### D-22 — Two trust assumptions, both stated openly
**The attestor**: five routes to detection without an outside observer were tested and
all closed. **The arbiter**: a contract cannot verify counter-evidence, so disputed
reports are resolved by a designated account — at MVP, the protocol owner.
*Withdrawn along the way:* the "self-proving, oracle-free claim", and target
self-reporting via `current_contract_code()` — malicious code can lie about itself.

### D-23 — The contract enforces a lookback bound, not temporal truth
`changed_at_block` must fall within `[report_block - MAX_LOOKBACK, report_block]`. That
bounds backdating; it does not eliminate it. Do not name a test "proves backdating is
impossible".

### D-24 — Concentration limits are per code hash, not just per address
Drift claims are correlated; many contracts share one implementation. Limits also per
global contract owner and per upgrade authority.

### D-25 — Aruna's own risk is excluded from coverage
The vault is a central point of failure. Mitigation is a TVL cap, immutability, and an audit
— not cover from its own pool.

---

## Engineering

### D-26 — The SDK sits under MCP, not beside it
An agent's deciding half speaks tool calls; its executing half is ordinary code. MCP
serves the first, the SDK the second — and the MCP server is written against the SDK.
The SDK is the published, versioned compatibility contract.
*Supersedes an earlier "MCP, not SDK" framing, which was a false choice.*

### D-27 — Contract ABIs generate TypeScript types as a build step
Without it the SDK and contracts drift silently and the first symptom is a failed
testnet transaction. With it, a changed signature breaks the build.

### D-28 — Immutable vaults mean migration tooling is a product requirement
A bug in a deployed vault can never be patched. New versions are new code hashes;
existing vaults run old code forever. Migration is an owner action needing a CLI
command and a console flow, and the registry tracks which vault runs which hash so a
security finding can be mapped to affected owners.

### D-29 — The attestor writes an on-chain heartbeat
A dead attestor emits nothing and the system looks healthy while monitoring has
stopped. Each target has an assigned attestor; the pool refuses new coverage on a target
whose assigned attestor's heartbeat is stale.

### D-30 — Attestor identity is separate from its signing key
A leaked key must be replaceable without invalidating past reports.

### D-31 — An indexer backs all history views
History cannot be rebuilt from RPC on every page load.

### D-32 — The apps are owned by a separate team
`FRONTEND.md` gives context, the questions each surface answers, and a short list of
non-negotiables. Layout and components are theirs. `prototype/` is a reference for flows, not
a screen spec; the docs win any conflict.

### D-33 — Testnet only for transactions, until the release gates pass
The classifier reads mainnet state read-only for the distribution measurement. Until
gate A, a mainnet account exists only to receive prize money.

### D-34 — Monorepo, with `lab/` inside it
The sandbox lab is our strongest evidence and must be re-runnable from the same repo.
Its results are not modified.

### D-35 — No meta-transactions
`DelegateV2` was removed at protocol 88.

---

## Product

### D-36 — The first paying customer is an agent-as-a-service company
A company running agents for clients has to answer "what is the guarantee?", and one URL
showing what the agent cannot do is that answer. *Accepted tension:* it buys the vault, the
area with the most competition. So the vault stays thin, and the classifier remains why it is
worth buying. The keyless tools stay free for everyone and bring credibility.

### D-37 — One vault per client; the client owns, the company operates
Funds stay with the client and the operator cannot take them, which is what makes the public
page a real guarantee. The operator may add agents within the client's ceiling, pause, revoke
and tighten; it may not loosen, resume, withdraw or change the owner. Detail: `CONTRACTS.md`.
*Cost accepted:* clients need a NEAR account, which is an onboarding cost to design for.

### D-38 — The vault is immutable, with migration
Chosen over a timelocked upgrade. A product selling certainty about whether code can change
should pass its own test. *Cost accepted:* bugs are remedied by migrating, so tooling, an
always-available owner withdrawal, version tracking and a TVL cap are all required. Closes
the former open question on this.

### D-39 — Four classes, plus a recorded basis
A near-sdk contract using `Promise` imports upgrade functions with no upgrade route, so
`local_upgradeable` alone would be too broad to be useful. Evidence records
`mutabilityBasis`. Taxonomy unchanged; no flow analysis. Detail: `CLASSIFIER.md`.
*Rejected:* a fifth class, which would ripple through every table; flow analysis, which risks
false negatives in a product selling certainty.

### D-40 — Coverage stays on testnet until drift frequency is measured
It runs in full there, with numbers labelled as assumptions. Mainnet needs release gate B.
The policy-to-price chain remains visible throughout.

### D-41 — Vault code uses low-level promise functions
Measured with near-sdk 5.30.1: `Promise` links 17 action imports, including deploy,
delete-account and add-full-access-key; the low-level form links only what it calls. See
`NEAR-FACTS.md` §4. *Cost accepted:* more verbose contract code.

### D-42 — Revenue is a subscription per vault
Paid by the AaaS company for drift monitoring, alerts and a branded public page. It runs
without coverage and covers monitoring cost from day one. It is billed off chain, so no fee
sits in an immutable contract. The classifier stays free. Coverage margin is additional
revenue after gate B. The price is open question 4.

### D-43 — Aruna runs the attestor and arbiter at first, openly
Realistic while no real money depends on coverage. The daemon is open source, and heartbeats
and rulings are public. An independent attestor is a condition of gate B.

### D-44 — Mainnet gates are explicit
A vault with real funds needs gate A: T5–T9, an independent audit, migration tooling, a TVL
cap and capped AaaS pilots. Coverage needs gate B on top. See `BUILD-PLAN.md`.

### D-45 — The measurement uses the NEAR BigQuery public dataset
Plain RPC cannot produce "top N by calls". The source is official and the query is published,
so others can repeat it. It needs the owner's Google Cloud credentials.

---

## Build decisions, v0 (10 November 2026)

### D-46 — `MAX_CLASS_AGE` is 3,600 blocks
About one hour. A vault refuses a spend against a target whose cached class is older, and the
same bound caps how late a missed freeze can arrive. Constant `MAX_CLASS_AGE_BLOCKS` in
`contracts/common`. Revisit with the attestor's polling interval (open question 3).

### D-47 — Auto-disable trips at weighted 24 within 1,200 blocks
Weights 1/2/4/8 by target class (`CONTRACTS.md`). Three agent-caused refusals against `unknown`
targets pause an agent; 24 against `immutable_verified` ones. Only agent-caused reasons count
(D-19). Constants in `contracts/common`.

### D-48 — Admin errors panic; only `spend` returns refusals
Adding an agent over the ceiling, an operator loosening a policy or resuming an agent are
authorization failures of the caller, so they panic with `ARUNA_*` and persist nothing (D-15).
The returning `SpendOutcome::Blocked` is reserved for the spend path, where the counter and event
must survive.

### D-49 — The v0 adapter is a NEAR swap against our own testnet target
One named action, `swap`, calling `swap(min_amount_out)` with the amount attached; the target
(`fixtures/contracts/swap`) pays its output back to its caller, so the adapter has no receiver
argument at all. Slippage is checked against a 1:1 rate because the fixture swaps NEAR for NEAR;
a real protocol's adapter must bring its own price reference. *Chosen over a third-party DEX:*
its address and behaviour are ours to verify and to make fail on demand (CLAUDE.md rule 1).

### D-50 — Contract tests use near-workspaces plus the lab's signer
`near-workspaces` 0.24 (near-sandbox 0.4, nearcore 2.14) runs the integration tests. Where it has
no API — publishing a global contract, and signing with an agent's function-call key so that a
rejection reads as an RPC error — the tests use the lab's hand-signing client.

### D-51 — Agent allowance is sized for calls in flight
A call is admitted only if the key's remaining allowance covers its prepaid gas at a pessimistic
price (`NEAR-FACTS.md` §10), held until the call finishes. An agent's allowance therefore bounds
how many of its calls can be in flight at once, not only its total gas. Agents call `spend` with
60 Tgas; size `agent_allowance` for the parallelism an agent needs.

### D-52 — Power-granting vault methods need a full-access key; agents are capped at 32
Owner-only methods, `add_agent`, `update_policy` and `resume_agent` require exactly 1 yoctoNEAR, so
a function-call key on the owner's or operator's account cannot call them; pause and revoke do not.
At most 32 agents that are not revoked per vault, and `refresh_class` only for targets in the
owner's ceiling, so neither the operator nor a stranger can drain the vault through gas allowances
or storage. From the internal review in `AUDIT-v0.md`.

### D-53 — A registry class record's `evidence_hash` is the sha256 of the evidence JSON
`evidence_hash` in `set_class` is the lowercase hex sha256 of `JSON.stringify(evidence)`, the
`evidence` object `classify` returns, in the engine's field order. Anyone can re-run the classifier
at a block near `classified_at_block` and compare; a later read differs in `checkedAtBlock` and any
state that moved, so the hash proves what was read, not that it is still true. Written by
`node fixtures/tools.mjs class-args <account>`, which uses `@aruna/classifier-core` and nothing else.

### D-54 — Coverage is per token, with no price conversion
Coverage, premium, underwriter capital, payout and recorded exposure are always in the same token:
NEAR, or one NEP-141 token the owner's ceiling lists. The pool keeps one book per token, and `k`
and concentration apply per book. Paying a token claim from NEAR exposure would need a price
oracle, a third trust assumption. Ceilings and policies therefore carry limits per token. On
testnet the token is Aruna's own test USDC, which has no value. From
`docs/plans/2026-11-10-2106-feat-coverage-loop-testnet-plan.md`.

### D-55 — Coverage is per target, priced through the agent's daily cap
One coverage names one agent, one target and one token. Its price depends on the target's class,
the sum insured `C`, the payout ratio, the window, and the agent's `daily_cap`, through the most it
can pay: `min(daily_cap × days × ratio, C)`, where `days` is the number of UTC days the window can
touch. `max_per_tx` is not an input (ten small spends reach the same daily total) and
`max_risk_class` only gates the purchase, since the target's class is already known. A tighter cap
lowers the price only while `daily_cap × days × ratio < C`. A payout counts only exposure recorded
inside the coverage's own window, after purchase and before `changed_at_block`; exposure from before
the purchase was never priced (found on testnet, where the same agent had swapped before buying).
Per-agent coverage across all of an
agent's targets, where `max_risk_class` would become a price input, is deferred.

### D-56 — A policy loosened after purchase voids the claim
Coverage records the policy version and the daily cap it was priced on. The vault records the
block of every loosening. A claim on coverage bought before that block is rejected, even if the
policy was tightened back later. Repricing after the fact would need the pool to charge the owner
more; rejecting is checkable and closes buy-tight-then-loosen.

### D-57 — The attestor infers the channel from state, and claims the earliest block
The four channels of D-13 are told apart by what changed between two observations, not by reading
transactions: a changed local code hash is `deploy_contract`; a ref that moved is
`use_global_contract`; an unchanged global-by-account ref whose executed code changed is
`deploy_global_contract`; anything else is `resolved_code`. `changed_at_block` is the first block
running the new code, found by bisecting historical `view_code` between the two observations; when
the RPC cannot serve that history, it is the block after the last unchanged observation. Either way
exposure recorded after the change never counts toward a payout. Detection lag is the polling
interval, and a report filed later than the lookback bound is refused (seen on testnet:
`ARUNA_OUTSIDE_LOOKBACK`). *Refines D-13.*

### D-58 — An attestor signs one canonical encoding, fixed by a golden vector
The signed bytes are a domain prefix followed by the report's borsh encoding, covering every
field. The registry verifies them with `env::ed25519_verify`; `fixtures/golden/drift-report.json`
is asserted by `contracts/common`, `contracts/registry` and `packages/attestor`.

### D-59 — A report freezes at once; freezes reach every vault; a slashed bond is pool capital
An accepted report freezes the target before its challenge window closes, so agents stop spending
into a changed target. The cost: with one attestor, one party can freeze any target at any time,
bounded only by its bond and the arbiter. The freeze is pushed in batches to every vault the
factory registered (the registry does not know vault ceilings); a vault ignores a target outside
its ceiling, and a vault the push misses learns at its next `refresh_class`. A bond the arbiter
slashes becomes capital in the pool's NEAR book. A freeze stays until the arbiter rejects the
report, or until the registry owner lifts it with `lift_freeze` once the latest report is final
(Verified or Rejected), typically after the target's new code is classified again. A lifted freeze
does not touch claims, which read the report's state.

### D-60 — The coverage stack is new, and chain time is block height
Testnet runs a second stack (registry v2, factory, pool, vault v3) next to the v0 stack, which
keeps working unchanged: the deployed factory fixes its registry at init. Every window (waiting
period, challenge window, lookback, heartbeat staleness, lockup, coverage) is a block count,
because `changed_at_block` and exposure checkpoints are blocks. Pricing turns blocks into days with
a declared `BLOCKS_PER_DAY` set low on purpose, so the price errs high.

### D-61 — A dispute settles both reports, and the loser's bond is slashed
The arbiter's ruling on one report of a dispute decides both: the winner is Verified, the loser
Rejected and its attestor's bond goes to the pool's NEAR book (D-59). The target stays frozen,
because a verified report stands either way; only `lift_freeze` ends the freeze. Ruling on one
report only left the other Disputed forever, which blocked `lift_freeze` and, on a rejection,
unfroze a target whose other report was still standing. *Refines D-22, D-59.*

### D-62 — A change is paid once: exposure counts from the last paid change
Each coverage keeps `paid_through_block`, the purchase block at first and then the block of each paid
change. A payout counts only exposure recorded after it and before the claimed change, and a
report whose change is at or before it is rejected. Without this, two agreeing reports for one
change, or two claims for two changes, paid the same exposure again. *Refines D-55.*

### D-63 — Purchase requests are refused, never panicked on, and bounded
A panic in the purchase callback strands the NEAR premium already sent, so every bad request (zero
or oversized limit, ratio outside 1..=10000 bps, window outside the waiting period and 30 days, an
agent with no daily cap in the token, a premium that rounds to zero) is a refusal that returns it.
Pricing saturates instead of overflowing. The window bound and the non-zero premium keep one buyer
from locking a book's capital or its capacity for free. A claim needs 150 Tgas up front and a stuck
one expires after 100 blocks, so nobody can wedge a coverage by claiming with too little gas.

### D-64 — SDK types come from the ABI; a quote is asked for with its shape; refusals come from logs
Each contract's ABI (`cargo near abi`) is committed in `contracts/<name>/res/` and
`scripts/gen-abi-types.mjs` turns it into `packages/sdk/src/generated/`; a test fails when the two
drift, and the vault clients type their method names against it. Premium impact is not returned by
every `aruna_simulate`: a price depends on a limit, ratio and window that a spend does not fix, so
`aruna_simulate` returns a quote only when the caller names those three, and `aruna_coverage_quote`
asks for one directly (this narrows the earlier text in `docs/MCP.md`). A purchase or claim finishes in
callbacks, so `OwnerCoverage` reads its outcome from the aruna events in the receipts' logs and
throws, rather than guessing, when they show none. Refusals from the pool are free text, so the SDK
passes the reason through unchanged. A non-owner's purchase is a refusal that refunds, not a panic.

### D-65 — A vault migrates by making a new one; the owner runs it, in steps that can be repeated
Vaults are immutable, so moving to a new version means a new vault, the same agent keys, and the
funds. `planMigration` only reads and refuses, before any transaction, a vault on an unknown code hash,
a signer who is not the owner (an operator could pause and add agents but not finish, so it is refused
up front), a vault already at the factory's version, and a vault already at the new name that is not a
copy (owner, operator and ceiling must match). `runMigration` goes: pause the carried agents on the
old vault, create the new vault, re-add each agent with its key, label and policy, move the funds,
revoke the old agents. An agent that was paused or auto-disabled is added and paused in one transaction,
so it is never active on the new vault; an auto-disable becomes an owner pause there. Each step reads
chain state first, so agents and the vault are never made twice. Funds cannot be recognised from chain
state (a withdrawal lands in the owner's general balance, a deposit emits no event), so a journal
records the plan and each fund transaction's hash, and writes "sending" after the owner confirms and
just before the send: a crash in between stops the run for a human look and never moves funds twice.
The old vault keeps its storage cost plus 0.001 NEAR; that is the margin, chosen, not measured. Active
coverage stays bound to the old vault, so the run refuses until the owner acknowledges it, and
`--yes` alone does not. A v1 vault takes no deposit on its owner methods (`CAPABILITIES`).
`aruna migrate` is the one signing command in the CLI, testnet only, with the key read from
near-cli-rs's legacy credentials and never from an argument.

### D-66 — The pool simulation: the contract's rules, an assumed world, and what it did and did not derive
`@aruna/sim` applies the pool's own rules (premium, capital adequacy, concentration, release, payout, the
withdrawal lock) and assumes everything else; each assumption is a field printed into every result, and
`P(event)` is labelled an underwriting assumption, not a measurement. The rules are held to the contract by
`fixtures/golden/pool-rules.json`, which the pool's test regenerates from the real pool and the model's test
replays. Published run: `packages/sim/results/2026-11-12/REPORT.md`, 1,000 seeded runs per scenario.
What it found, under those assumptions:
- **Concentration limit.** The contract's 2 x capital on one code hash or upgrade authority is too loose for one
  authority changing everything it controls: P(a claim goes unpaid) is 8.4% there. The largest value that
  keeps it at or under 1% is **1.4 x** (0.9%, 95% interval 0.5% to 1.7%, so at the edge; 1.3 x is the
  conservative reading), **1.2 x** if changes are twice as frequent as declared, **0.75 x** if five times.
- **`k`.** Not identified at the declared P(event): at every `k` from 2 to 16 the bound holds in all three
  scenarios once concentration is 1.4 x. If changes are two or five times as frequent, `k` of 3 is the largest
  that holds. The contract keeps 5.
- **Withdrawal.** The contract's lock refused the underwriter's withdrawal in every run: agents renew, so the
  book is never idle. Without the lock, half the capital leaves on day 25 and ending capital falls from about
  3,500 to about 1,300 NEAR.
- **A pool with 100 NEAR, no adequacy rule and no concentration limit, hit by one authority's change, goes
  unpaid in 99% of runs.** That is a thin pool without the rules; the run does not say which rule matters more.
Nothing is locked and no contract constant changed: locking needs the measured drift frequency (open
question 1) and the gate B review. Departures from the plan, on purpose: the plan says to derive "the smallest
values" that keep the probability under the bound, but a smaller limit is always safer, so the largest is
taken; it derives from three scenarios, not two, because normal operation and one target changing stay at 0%
for every value tried and constrain nothing; claims refused for want of capital are retried daily, which
makes "unpaid at the end" forgiving, so the peak owed at once is reported beside it; and the selection rule
was fixed after an exploratory run, not before.

### D-67 — A keeper releases a freeze after re-classification, when the class is no riskier
Supersedes D-59's practice of an owner review before every `lift_freeze`. Once a target's latest report is final
(Verified or Rejected) and its class record is older than that report, a keeper service re-classifies the target with
the same engine, then lifts the freeze and writes the new class; when the new class is riskier than the recorded one
(`immutable_verified < local_upgradeable < global_by_account < unknown`) it writes the class and leaves the freeze for a
person. It never acts while the latest report is Pending or Disputed. The chain is its only memory: a record newer than
the report means the target is handled, and the lift comes before the write, so a run that stops between them is
finished by the next. Run by Aruna, as the registry owner, with a function-call key limited to the registry and to
`set_class` and `lift_freeze`, in a service of its own (`packages/keeper`) so an attestor run by someone else, a
condition of release gate B, never carries this code or key. It is Aruna's automation of the registry owner's authority,
not a third trust party.
Costs accepted. Spending into the changed code reopens without a person having read it; what still protects an owner
is the class order here and each agent's `max_risk_class`. The key can record any target as any class, so a leak could
record a dangerous target as `immutable_verified`: guard it as a secret, keep the owner's full-access key off the
host, and revisit before mainnet. Corrects D-59: the registry keeps a freeze after the arbiter's ruling, on either
side; only `lift_freeze` ends it (`contracts/registry/src/drift.rs`). Plan:
`docs/plans/2026-11-13-2018-feat-hosted-attestor-keeper-plan.md`.

## Open questions — do not invent answers

Flag and ask. Writing a plausible number here is the failure this list exists to
prevent.

1. **How often do actively-used NEAR contracts change code?** Determines whether the
   coverage layer is economically viable, since the parametric trigger pays on every
   verified change, not only malicious ones. Measurable from history, with the caveat
   that counting `DeployContract` alone misses global-by-account changes.
2. **`k` for capital adequacy, and the concentration limit per code hash.** Derive from
   simulation, then lock as constants with no admin key — the absence of an admin key
   is part of the product's promise.
   *Simulated 12 November 2026 (D-66): a concentration limit of 1.4 x capital under the
   declared P(event), `k` not identified there. Derived under assumptions, not locked: locking
   waits for question 1 and the gate B review.*
3. **`MAX_CLASS_AGE` and the attestor's polling interval**, and how both enter the
   coverage period definition. Detection lag adds to the TOCTOU window.
4. **The subscription price per vault.** Validate with AaaS prospects. It must exceed
   measured monitoring cost per vault, which grows with target count.
5. **The TOCTOU window under multi-shard.** Three blocks is a single-shard lower bound.
6. **Client onboarding without a NEAR account.** D-37 needs each client to hold one. How
   much an AaaS company can do for a client without becoming its custodian is unresolved.
