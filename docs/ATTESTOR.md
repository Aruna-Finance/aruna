# Attestor and the claim lifecycle

The attestor is one of Aruna's two trust assumptions, and it is **permanent**. The
other is the arbiter, below. Never call this system trustless in code, comments or
documentation.

---

## Why permanent

Five routes to detection without an outside party were tested; all are closed
(`NEAR-FACTS.md` §1). In short: a contract cannot read another contract's code
identity, checking before execution is not binding because of the TOCTOU window, and a
target cannot be trusted to report itself because malicious code can lie about itself.

The attestor is part of the design, not a shortcut to a better version. Present it that
way.

## What the attestor controls

More than it looks. It reports **whether** a change happened **and at which block**,
and a contract cannot verify a claim about a past block.

Moving the event in time changes whose coverage was active, which changes who gets
paid. Mitigation at first release:

1. **A slashable bond.** The arbiter's ruling can cut it.
2. **A challenge window.** No payout until it closes.
3. **A lookback bound** on the claimed block.

**Who runs it.** Aruna runs the attestor and the arbiter at first, openly: the daemon is open
source, and heartbeats and rulings are public. An attestor independent of Aruna is a condition
of coverage on mainnet (release gate B). A quorum is the path beyond that.

---

## What the contract can and cannot enforce

Be precise here; an earlier draft overstated it.

**Can:**
- bound `changed_at_block` to `[report_block - MAX_LOOKBACK, report_block]`
- hold and slash the bond
- run the challenge window
- mark two conflicting reports on the same target and window as `Disputed`, blocking
  payout

**Cannot:** verify counter-evidence drawn from chain data. "Anyone may challenge with
on-chain evidence" is not implementable as written, because the contract cannot read
that evidence.

**Therefore the arbiter.** A disputed report is resolved by a designated arbiter
account — at MVP, the protocol owner. This is a **second trust assumption** and belongs
next to the attestor in the README, not in a footnote.

Do not name a test "proves backdating is impossible". The test asserts the lookback
bound is enforced, nothing more.

---

## What it watches

Four channels, all required. Detail in `CLASSIFIER.md`. The one most easily missed is
`DeployGlobalContract` on the **owner** of a global contract — a change that never
touches the target account, and the reason `global_by_account` targets can be monitored
at all.

The attestor imports `@aruna/classifier-core`. It runs the same checks as the browser
page and the MCP tool, on a schedule.

## Report shape

```ts
type DriftReport = {
  target: string;
  observedAtBlock: number;
  changedAtBlock: number;        // ATTESTOR'S CLAIM — not verifiable on chain
  beforeRef: CodeRef;
  afterRef: CodeRef;
  beforeResolvedHash: string;    // REQUIRED
  afterResolvedHash: string;     // REQUIRED
  channel: "resolved_code" | "deploy_contract" | "use_global_contract" | "deploy_global_contract";
  attestor: string;
  nonce: string;
  expiresAt: number;
};
```

The resolved hashes are **required**, not optional. For `global_by_account` targets the
`CodeRef` is identical before and after — it is only the owner's account id. The
resolved hash is the thing that changed. **Reject any report whose two resolved hashes
match.**

Reports are signed, and the signature binds target, both refs, both resolved hashes,
nonce and expiry, so a verdict cannot be replayed against a different request. Share a
golden test vector between the Rust contract and the TypeScript attestor so the two
never drift.

---

## Lifecycle

```
attestor observes a change
        │
        ▼
report_drift(DriftReport)        bond locks; lookback bound checked
        │
        ▼
target frozen                    pushed in batches; a missed vault learns at next refresh;
        │                        new transactions refused, not atomic across vaults
        │                        anything already in flight cannot be stopped
        ▼
challenge window
        │
   ┌────┴───────────────┐
conflicting report    closes clean
   │                     │
   ▼                     ▼
Disputed: no payout   claim approved
   │                     │
   ▼                     ▼
arbiter decides       parametric payout from pool, to the owner
   │
   ├─ report upheld   → claim approved, payout
   └─ report rejected → claim rejected, bond slashed
```

## Payout

```
payout = min(recorded_exposure × payout_ratio, coverage_limit)
```

Worked example: recorded exposure $400, ratio 80%, limit $500 → **$320**. Every input
is on chain before the event. `recorded_exposure` is what passed through the vault, not
the position's current value.

All must hold, re-validated **at payout time**, not at report time:

- the target is covered by this agent's policy
- the change falls inside an active coverage window, after the waiting period
- exposure was recorded **before `changedAtBlock`** — not before the report block
- the coverage limit is not exhausted
- the challenge window has closed and no dispute is open

If any fails, the claim is rejected and the reason recorded.

---

## Operational requirements

These are not polish. Two of them are the difference between a demo and a product.

**Heartbeat.** A dead attestor emits nothing. The system looks healthy: no claims
arrive, everything appears fine, and monitoring has silently stopped. This is more
dangerous than a visible outage. The attestor writes a heartbeat on chain. Each target has an
assigned attestor; the pool refuses to sell new coverage on a target whose assigned attestor's
heartbeat is stale, and the console
surfaces it. **Absence of signal must be detectable on chain**, not only in a
dashboard.

**Key rotation.** Attestor identity is separate from its signing key. A leaked key is
replaced without invalidating past reports, and the registry records which key signed
which report.

**Polling interval is part of the product.** Detection time is bounded by the interval,
and that adds to the TOCTOU window. It belongs in the coverage period definition, not
buried in a config file. In the lab, new code became active 3 blocks after the owner's
deploy on the by-account path.

**Monitoring cost.** Polling the resolved code for every insured target, plus every
referenced global contract owner, grows with target count and must be covered by
the subscription (D-42), then premiums. Record the real figure during implementation; it sets
the floor for open question 4 in `DECISIONS.md`.

---

## Not covered

State this in the README and on the coverage purchase screen:

- poor investment decisions — an agent buying a worthless token
- losses from price movement
- a vulnerability exploited **without** a code change
- bugs or exploits in Aruna itself — **explicitly excluded**

The last matters. The vault holds many agents' funds and is a central point of failure.
Its mitigation is a TVL cap, immutability and an audit — not cover from its own pool.
