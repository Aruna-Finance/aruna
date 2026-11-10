# Contracts

On-chain detail. System view is in `ARCHITECTURE.md`; read `NEAR-FACTS.md` first.

---

## Error model — refusals return, authorization panics

This split is mandatory and it is easy to get wrong. **A panic reverts state**, so a
refusal that panics cannot increment a counter, write a log entry or emit an event —
which would make auto-disable impossible.

| Situation | Behaviour |
|---|---|
| **Policy refusal** | **Return** `SpendOutcome::Blocked { reason }`. State persists: event emitted, log written, counter incremented where the table below says so |
| **Authorization failure** — key not registered, caller is not the owner or operator, method misuse | **Panic** with `ARUNA_*`. Nothing should persist |

The SDK surfaces the first as a result and the second as a thrown error.

### Canonical refusal reasons

SDK reason codes are these names without the `ARUNA_` prefix. A test asserts the sets match.

| Reason | Counts toward auto-disable |
|---|---|
| `ARUNA_TARGET_NOT_ALLOWED` | yes |
| `ARUNA_MAX_PER_TX_EXCEEDED` | yes |
| `ARUNA_DAILY_CAP_EXCEEDED` | yes |
| `ARUNA_SLIPPAGE_TOO_HIGH` | yes |
| `ARUNA_RISK_CLASS_NOT_ALLOWED` | no: a target can be reclassified under an honest agent |
| `ARUNA_TARGET_FROZEN` | no: a freeze hits every honest agent on the target |
| `ARUNA_CLASS_STALE` | no: routine, and absorbed by the SDK |
| `ARUNA_INSUFFICIENT_BALANCE` | no: the owner's funding, not the agent's behaviour |
| `ARUNA_AGENT_NOT_ACTIVE` | no: already stopped |
| `ARUNA_AGENT_AUTO_DISABLED` | no: already stopped |

---

## `vault` — one per client

Deployed by the factory from one global contract **by hash**, with **no full-access
key**. Authority lives in state, not in a key.

Since vault v3 the ceiling and every policy carry limits **per token**: NEAR, or a NEP-141 token the
ceiling lists. Budgets, reservations and exposure are per token, with no conversion (D-54). A second
named adapter, `ft_swap`, moves a token with `ft_transfer_call` and the 1 yoctoNEAR the vault attaches
itself. Exposure is kept as checkpoints, readable with `exposure_before(agent, target, token, block)`;
each policy change bumps a version and records any loosening (D-56); `freeze_target` takes a freeze
from the registry.

### Owner and operator

For the first customer, an agent-as-a-service company, the **client is the owner** and the
company is the **operator**. The promise to the client is that the operator cannot take
their money, and the contract enforces it.

| Action | Owner | Operator |
|---|---|---|
| Set the ceiling: per-transaction, vault-wide daily total, targets, riskiest class, allowance | yes | no |
| Add an agent, with a policy inside the ceiling | yes | yes |
| Pause an agent, revoke an agent, tighten a policy | yes | yes |
| Loosen a policy, resume a paused or auto-disabled agent | yes | **no** |
| Withdraw, change the owner, set or remove the operator | yes | **no** |

- The ceiling covers the **sum** of daily caps across agents, or an operator could reach any
  total by adding keys.
- The operator holds agent keys, so it can spend within policy. Every adapter must return
  proceeds to the vault; if an adapter could pay elsewhere, the promise fails.
- `operator: Option<AccountId>` in state. A vault with no operator works as a plain owner
  vault.

### Why no full-access key

A vault whose owner holds a full-access key classifies as `local_upgradeable` under our
own classifier, which would collapse the headline claim. Instead:

- `owner: AccountId` in state; owner-only methods assert
  `env::predecessor_account_id() == self.owner`
- Agent keys are added and removed **by the contract itself**, through
  `env::promise_batch_action_add_key_allowance_with_function_call` and
  `env::promise_batch_action_delete_key`. This needs no full-access key.
- Owner recovery changes `owner` in state; there is no key to hand over.

**Never use near-sdk's `Promise` in this contract**, including `ext_contract` helpers built
on it. Measured with near-sdk 5.30.1: a contract using `Promise` links 17
`promise_batch_action_*` imports, including deploy, delete-account and add-full-access-key,
and would fail its own classifier. The low-level form links only what it calls.

**Load-bearing and must be confirmed in the lab (T7):** the compiled vault imports
`promise_batch_action_add_key_with_function_call` but none of the scanned functions in
`CLASSIFIER.md`, with `cargo near build`.

### Agents are keys, with labels

```rust
pub struct Agent {
    pub label: String,              // human-readable, shown on the public page
    pub status: AgentStatus,        // Active | Paused | Revoked
    pub policy: Policy,
    pub refusals: RefusalCounter,   // risk-weighted, rolling window
    pub created_at: u64,
}

pub struct Policy {
    pub max_per_tx: U128,
    pub daily_cap: U128,
    pub max_slippage_bps: u16,
    pub allowed_targets: Vec<AccountId>,
    pub max_risk_class: RiskClass,
}

pub struct Budget {
    pub balance: U128,
    pub spent_today: U128,
    pub reserved: U128,             // in flight, not yet settled
    pub day_index: u64,
}

pub struct Exposure {
    pub agent: PublicKey,
    pub target: AccountId,
    pub amount: U128,               // what was SENT, not the position's current value
    pub class_at_record: RiskClass,
    pub first_seen: u64,
    pub last_updated: u64,
    pub checkpoints: Vec<(u64, U128)>, // (block, cumulative), for exposure before a block
}

pub struct CachedClass {
    pub class: RiskClass,
    pub frozen: bool,
    pub classified_at_block: u64,   // when the registry recorded it, shown to users
    pub fetched_at_block: u64,      // when this vault fetched it; the bound applies to this
}
```

Agent identity is `env::signer_account_pk()`. The contract maps the key to its label,
policy and status.

`Exposure.amount` is what passed through the vault, **not** the position's current
value — the vault cannot read the target's state. Payouts use this number, and the gap
is part of the parametric definition.

### The `spend` flow

```
agent key ──► vault::spend({ adapter, action, params })
                │
                │ 0. signer_account_pk() is registered AND status == Active
                │    (this is what surfaces ARUNA_AGENT_AUTO_DISABLED)
                │ 1. target in policy.allowed_targets
                │ 2. cached class not frozen
                │ 3. cached class fresh (fetched_at_block) — else ARUNA_CLASS_STALE
                │ 4. class ≤ policy.max_risk_class — checked NOW, not at policy time
                │ 5. amount ≤ max_per_tx
                │ 6. balance sufficient
                │ 7. spent_today + reserved + amount ≤ daily_cap   ← reservation
                │ 8. adapter validates params
                │
                ├─ refused → RETURN Blocked{reason}; event, log;
                │            counter++ only for the reasons marked above
                │
                └─ allowed → reserved += amount
                             promise to target via adapter
                             └─ cb_settle:
                                  ok   → reserved -= amount; spent_today += amount;
                                         exposure updated; event
                                  fail → reserved -= amount; nothing else
```

**Step 4 is deliberate and differs from the five projects surveyed in `COMPETITIVE.md`.**
They validate against the target list fixed at configuration time; we re-check the most
recently recorded class at execution. A target recorded as changed since the policy was written
is refused from then on, not grandfathered.

**`refresh_class(target)` is callable by anyone,** including agent keys, whose method list
must include it for the SDK's automatic retry. It is safe: it only pulls the registry's value
through a callback and accepts no class as input. Its callback is `cb_` prefixed like every
other.

**Step 7 must be reservation accounting.** Receipts are asynchronous, so `spent_today`
has not increased when the next check runs. Ten parallel requests of $20 would all pass
a naive $100 cap. The correct check is `spent + reserved + requested ≤ cap`, and its
test must be **parallel** — a serial test passes a broken implementation.

### The callback footgun

With keys on the vault, an agent's call satisfies
`predecessor_account_id() == current_account_id()` — the usual guard for private
callbacks. **An agent key would pass it.** The only thing stopping an agent invoking a
callback is `method_names` on its key.

Therefore: callbacks are prefixed `cb_`; a unit test asserts no `cb_` name appears in
any agent key's method list; an integration test attempts every `cb_` method with an
agent key and expects `MethodNameMismatch`.

`method_names` is **load-bearing security**, not configuration.

### Risk tier encoded in the key

Agents permitted only `immutable_verified` targets get a different `method_names` set
from those permitted riskier classes. Part of the policy is enforced by the protocol
rather than only by the contract.

### Adapters

No free-form `execute(target, method, args)`. A generic path turns the vault into a
proxy that can call anything and the containment is gone.

```rust
pub trait Adapter {
    fn validate(&self, action: &Action, policy: &Policy) -> Result<(), ArunaReason>;
    // Built with env::promise_batch_*; near-sdk's Promise is banned in the vault.
    fn build(&self, action: &Action) -> PromiseIndex;
}
```

Slippage enforcement is only as good as the adapter: the vault has no price source, so
it relies on the target honouring `min_amount_out`. State that limit in the README.
Every adapter must send proceeds back to the vault. MVP ships one adapter.

### Auto-disable, risk-weighted

| Class of the refused call's target | Weight |
|---|---|
| `immutable_verified` | 1 |
| `local_upgradeable` | 2 |
| `global_by_account` | 4 |
| `unknown` | 8 |

Only agent-caused reasons count (see the reason table). Otherwise a freeze on a popular
target would disable honest agents across every vault. Above a threshold within a rolling
window, status becomes `Paused` and `agent_auto_disabled` fires. An injected agent produces a
burst of refusals, so the refusal log becomes an active defence. This only works because
refusals return rather than panic. Only the owner can resume it.

### Withdrawal

`withdraw_to_owner` is **owner-only**, stays available in every state, and sends only to the
registered owner. Nothing reachable by an agent or the operator moves funds to an arbitrary
address, by design.

### TVL cap

Each vault version carries a TVL cap, as a safety limit on an immutable contract. Deposits
above it are refused. Its value is decided at release gate A.

---

## `registry` — shared

Source of truth for what class a target is and whether it is frozen.

Holds: classifications and their evidence hashes, drift reports, challenge windows,
attestor identities, bonds and signing keys, each target's assigned attestor, heartbeats,
the authorized classifier set, vault version records.

**Only accounts in the authorized classifier set may write a class.** Specify and
enforce this; an open write path makes every downstream decision meaningless.

### Drift reports

```rust
pub struct DriftReport {
    pub target: AccountId,
    pub observed_at_block: u64,
    pub changed_at_block: u64,        // ATTESTOR'S CLAIM — not verifiable on chain
    pub before_ref: CodeRef,
    pub after_ref: CodeRef,
    pub before_resolved_hash: Vec<u8>, // REQUIRED
    pub after_resolved_hash: Vec<u8>,  // REQUIRED
    pub channel: DriftChannel,
    pub attestor: AccountId,
    pub nonce: u64,
    pub expires_at: u64,
}
```

The resolved hashes are required because for `global_by_account` targets the `CodeRef`
is identical before and after — it is only the owner account id. The resolved hash is
the thing that changed. **Reject any report where the two resolved hashes match.**

### What the contract can and cannot enforce

It **can**: bound `changed_at_block` to `[report_block - MAX_LOOKBACK, report_block]`;
hold the attestor's bond; run the challenge window; mark conflicting reports `Disputed`.

It **cannot**: verify counter-evidence from chain data. Dispute resolution is by a
designated arbiter account — at MVP, the protocol owner, declared as a trust assumption
alongside the attestor.

Do not write a test named "proves backdating is impossible". The test asserts the
lookback bound is enforced, nothing more.

### Freeze propagation

A verified drift report freezes the target. The registry pushes the freeze to subscribed
vaults in batches, because one transaction's gas limits the fan-out. Routine class updates
are pulled with a staleness bound (`ARCHITECTURE.md`). **A vault the push misses learns of
the freeze at its next refresh, so the staleness bound is also the upper limit on freeze
delay.** The freeze is **not atomic across vaults** — say so in the README.

---

## `pool` — shared

Underwriter capital, coverage policies, and payouts. Only the pool has the global view
needed to enforce concentration. **Testnet only until release gate B.**

As built (`contracts/pool`): one book per token (D-54); coverage per target, priced through the
agent's daily cap (D-55); every window in blocks (D-60). The parameters, all declared assumptions,
are in `contracts/common/src/params.rs`.

```rust
pub struct Coverage {
    pub owner: AccountId,           // payouts go here
    pub vault: AccountId,
    pub agent: PublicKey,
    pub target: AccountId,
    pub limit: U128,
    pub payout_ratio_bps: u16,
    pub premium_paid: U128,
    pub starts_at: u64,
    pub waiting_period_ends: u64,   // anti self-dealing
    pub expires_at: u64,
}
```

**The waiting period is the defence against self-dealing:** an owner who also controls the
target cannot buy coverage and immediately upgrade their own contract.

Purchase also checks the target's assigned attestor's heartbeat, read from the registry. The
purchase path may be async.

### Premium

```
ExpectedLoss = P(event) × CoverageLimit × PayoutRatio
Premium      = ExpectedLoss + CapitalCost + OperationalCost + RiskMargin
```

Every input except `P(event)` is computable from on-chain state. **`P(event)` is an
underwriting assumption** until the drift-frequency question is measured — write it as
a declared parameter, not buried in a formula.

### Two rules that must not be absent

**Capital adequacy.** Total coverage ≤ `k` × pool capital. Without it this is a
fractional reserve that dies on the first large claim.

**Concentration limits.** Drift claims are correlated: one popular implementation
changes and every exposed policy claims in the same block. Limits apply per **code
hash**, per global contract **owner**, and per upgrade authority — not merely per
address, because many contracts share one implementation.

### Capital lockup

Underwriter capital is locked until all of: coverage expiry, the claim reporting
period, pending claims resolved, and all challenge windows closed.

### Payout

```
payout = min(recorded_exposure × payout_ratio, coverage_limit)
```

Worked example: recorded exposure $400, ratio 80%, limit $500 → **$320**. That figure
is the formula's output, not a measurement of actual loss. Say so on the purchase
screen.

Re-validate **at payout time**, not at report time: the target's class, the coverage
window, and that exposure was recorded before `changed_at_block` — not before the
report block. The pool asks the vault for `exposure_before(agent, target, block)`, from its
checkpoints, and **accepts the answer only from factory-registered vaults with a known code
hash.** A vault deployed by anyone else could report any number.

### Not covered

Poor investment decisions, price movement, exploits without a code change, and **bugs
or exploits in Aruna itself — explicitly excluded.** The vault is a central point of
failure; its mitigation is a TVL cap, immutability and an audit — not cover from its own
pool.

---

## `factory`

Deploys vaults from one global contract by hash, sets `owner` and `operator` in state, adds
no full-access key, and registers the vault with the registry including its code hash for
version tracking.

It lives at `aruna.testnet`, because a parent can only create its direct sub-accounts, and
vault names are one label: `vault-<client>.aruna.testnet`. Availability of these testnet
names is unverified. That parent is exactly what T9 examines.

A vault deployed this way, with no full-access key and clean imports, is
`immutable_verified` **under Aruna's own classifier**, pending T5, T7 and T9. Publish that
self-classification with evidence.

---

## Events

NEP-297, `standard: "aruna"`.

`agent_registered`, `agent_status_changed`, `agent_auto_disabled`, `policy_updated`,
`operator_changed`, `ceiling_updated`,
`execution_allowed`, `execution_rejected`, `exposure_recorded`, `class_refreshed`,
`target_classified`, `target_frozen`, `coverage_purchased`, `drift_reported`,
`claim_disputed`, `claim_approved`, `claim_rejected`, `payout_executed`,
`attestor_heartbeat`, `vault_deployed`

`execution_rejected` carries the reason code and the target's class at the moment of
refusal. It is what makes the demo legible on chain, and it is what the indexer reads
to build the activity view.
