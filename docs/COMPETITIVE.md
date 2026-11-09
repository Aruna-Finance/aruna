# Competitive landscape — read this first

Five teams in this hackathon already shipped a vault-plus-scoped-key spending guard.
They started 29–31 October. Some have more tests than we will write.

**If Aruna ends up looking like them, it loses.** This document exists so that no
design decision quietly rebuilds their product.

---

## What already exists

| Project | What it has |
|---|---|
| **Veto** | Spending firewall. 94 JS + 31 Rust tests, 29 adversarial scenarios with asserted verdicts, 1000 random actions against invariants, zero-install browser demo, NEP-297 deny events with reason codes, queued approvals re-checked against current policy |
| **Allowance** | Vault + factory via global contract, agents as function-call keys on the vault account, kill switch that deletes agent keys at protocol level, receipts a payee verifies with one view call, `simulate` free view, revenue split, counterparty-risk service, MCP server |
| **AgentGuard** | Vault + human approval + TEE risk oracle via OutLayer, signed verdicts with forge/expiry/replay/swap tests, golden vector shared Rust↔TS, 103 tests, MCP server, cross-chain checks |
| **LeashPay** | Vault with per-tx cap, daily cap, allowlist, approval queue, pause, on-chain audit log, live testnet contract |
| **Spend Guard** | Vault with policy, live read-only dashboard on GitHub Pages, injection scenarios, documented pilot plan with measurable targets |

All five open with a near-identical sentence: *"give your agent a budget, not your keys."*

That convergence is not an accident and not caused by everyone using the same AI.
The hackathon's own track description asks for exactly this — *"spending limits, wallet
safeguards... give AI money without handing it the keys"* — and the starter prompt file
for the `security` track specifies the architecture down to the scoped function-call key
and the prompt-injection demo. The organizers handed everyone the same idea.

A second cause is structural: NEAR's one distinctive primitive for agents is the scoped
access key, and there is essentially one correct way to use it.

---

## What Aruna must not rebuild

These are solved, by teams further along. Building them as *the product* means losing.

- Human approval queues
- Deny-lists and counterparty reputation scoring
- TEE risk oracles
- Generic agent-wallet UX
- "Spending firewall" as the headline

Aruna has a vault. The first customer buys it (`DECISIONS.md` D-36), but it is worth buying
**because the classification is actionable**, and it never leads the message. What it adds for
that customer is the split between client as owner and company as operator. Keep it thin.

---

## What is genuinely ours

Verified by our own lab. None of the five has any of it.

> **Scope of the comparisons below.** "None of them" means none of the five projects
> surveyed here, whose repositories were read directly. It is not a claim about every
> project in the hackathon or the ecosystem. Keep comparative statements scoped this
> way in the README too — every claim needs something behind it.

**1. The `global_by_account` blind spot.** For contracts that reference a global
contract by account id, the executed code can change with **no transaction touching the
target** and with `view_account.code_hash` never changing. Anyone monitoring code
changes the standard way is blind to it — which likely includes Allowance's risk
service.

**2. Import-section absence as a soundness proof.** A contract cannot call a host
function it does not import. So the absence of deploy and key-management imports is
proof of absent capability, not a heuristic. None of the five uses this.

**3. A four-class taxonomy grounded in protocol facts**, with `unknown` as an honest,
uninsurable class. The others produce risk scores; we draw a line between what can be
proven and what cannot.

**4. Exposure as a priced quantity.** All five are pure enforcement with zero economics.
None of them prices anything.

**5. Depth of verification.** Not one of their READMEs mentions the TOCTOU window, the
limits of what a contract can read, or protocol version drift. We measured all three.

---

## Mechanisms we are deliberately adopting

Taking a good mechanism is not the same as copying a product. Each of these makes our
unique part more visible, more usable or cheaper — that is the test.

| From | Mechanism | How ours differs |
|---|---|---|
| Veto | Zero-install browser demo | Ours is read-only by nature: paste any mainnet contract, get its class live. No wallet, no backend |
| Veto | Property tests against invariants | Our invariants are richer: reservation accounting, pool solvency, concentration limits, challenge-window ordering |
| Veto | Re-validate queued approvals against current policy | We apply it at the **gate**: re-check the target's class at execution time, not at policy-set time |
| Allowance | Agents as function-call keys on the vault account | We add a human-readable label per key, and let `method_names` encode the risk tier the agent may touch |
| Allowance | Auto-disable an agent that keeps getting refused | Ours is risk-weighted: refusals against `global_by_account` or `unknown` targets count more |
| Allowance | Factory deploying vaults from one global contract by hash | Ours classifies **itself** as `immutable_verified` and shows the evidence. They cannot — they have no classifier |
| AgentGuard | Signed verdicts with forge/expiry/replay/swap tests | Our attestor also asserts a **block number**, which theirs does not. We add temporal binding and backdating tests |
| AgentGuard, Allowance | MCP server as the integration surface | Our classifier tools are **keyless and work for any NEAR contract**, including agents that never touch our vault |
| LeashPay | Refuse to start on a non-testnet config | Same, as a credibility signal |
| Spend Guard | Concrete pilot with measurable targets | Ours is a measurement, not a demo: class distribution across the top N mainnet contracts |

---

## The positioning sentence

Use this, or something that passes the same test:

> Aruna measures whether the contracts an agent touches can still change — and found a
> class that can change without any transaction touching them, and without the field
> everyone monitors ever changing.

**The test:** could any of the five write this sentence? If yes, rewrite it.
"Give your agent a budget, not your keys" fails. "A spending firewall for AI agents"
fails. The sentence above passes.

The first screen of the README decides how everything after it is read. If the first
screen looks like theirs, the depth never gets read.
