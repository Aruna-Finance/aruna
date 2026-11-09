# Frontend — role, scope and expectations

**A separate team owns the apps.** This document gives them context, the job each
surface does, and the few things that are product rather than design. Layout,
components, visual language and framework details inside Next.js are theirs to decide.

What this document is not: a screen spec. If something here reads like one, treat it as
an example. `prototype/` shows the flows, and this document wins any conflict with it.

---

## Context in one page

Aruna answers one question — *can this contract change under me?* — and builds three
things on it: a free lookup, a vault that enforces policy based on the answer, and
coverage that pays if a contract you were exposed to changes.

The product's economic claim is **the chain from policy to price**: a tighter policy
means lower maximum exposure, which means a cheaper premium. If the interface does not
make that chain visible, the product reads as a dashboard and the thesis is lost.

For the full picture read `PRODUCT.md`. For why this is not "another agent spending
guard", read `COMPETITIVE.md` — it matters for copy, because five comparable products
open with nearly the same sentence and we must not.

---

## Data sources

| Need | Source |
|---|---|
| Classification of any account | `@aruna/classifier-core` directly, in the browser. No backend |
| Contract reads and writes | `@aruna/sdk` |
| History, lists, activity, charts | `@aruna/indexer` |

Do not read history from RPC per page load — that is what the indexer exists for. Do
not route classification through a backend; it must work from a static page.

---

## Four surfaces

### 1 · `apps/web` `/` — the classifier page

**Audience:** anyone, including people who have never heard of Aruna.
**Constraint that is not negotiable:** static, no backend, no wallet, no sign-up. It
must work from a plain static host.

**Questions it answers**
- What class is this contract, and what is the evidence?
- How do I verify that myself?
- For the invisible-change case: which field is lying, and what is the true one?

This is the front door and usually the first thing a new person touches. The
side-by-side of the monitored field versus the resolved code hash is the single most
important thing on it — that comparison is the finding.

### 2 · `apps/web` `/console/` — owner dashboard

**Audience:** the AaaS company as operator, and its client as owner. They see different
actions. The operator must see plainly what it cannot do, and the client must be able to remove
the operator.

**Questions it answers**
- How much is at stake right now, and on what?
- Which agents are running, and what can each one do?
- Which of my targets can change, and has any changed class recently?
- What does my policy cost me, and what would a tighter one cost?
- What did my agents try to do, and what was refused?

**The policy-to-price panel is product, not decoration.** Changing a daily cap or the
riskiest class allowed must move the premium visibly, in the same view. Everything else
on this surface is open to the team's judgement; this is not.

**Coverage is labelled testnet with assumed numbers** until release gate B.

Also needed here, and easy to miss: **vault migration**. Vaults are immutable, so a new
version means creating a new vault and moving funds. That flow lives here.

### 3 · Public agent page

**Audience:** an AaaS company's client, and anyone deciding whether to transact with somebody
else's agent. This page is what the company sells, and it may carry the company's brand.
**Constraint:** no login.

**Questions it answers**
- What can this agent **not** do, and who enforces that?
- Who owns the funds, and what can the operator not do?
- What are its economic limits, and how much has it used today?
- What is it exposed to, and in which risk classes?
- How do I check all of this myself?

The emphasis on *cannot* is deliberate. The honest answer to "what is my guarantee" is
a list of protocol-enforced impossibilities, not a list of features. Because agents are
keys on the vault, one `view_access_key_list` call backs most of this page.

### 4 · Underwriter view

**Audience:** someone supplying capital.

**Questions it answers**
- How much of my capital is deployed, and how much is locked?
- **How concentrated is the pool's exposure on a single code implementation?**
- What claims are pending, disputed or paid?
- Is the attestor alive?

The concentration question is the one that decides whether the pool survives, and it is
not the question most dashboards ask. Give it the weight it deserves.

---

## Non-negotiables

Short list, and everything not on it is the team's call.

1. `apps/web` stays static, keyless and backend-free.
2. The policy-to-price relationship is visible and interactive on the owner surface.
3. The public agent page requires no login.
4. Refusals are shown as **normal outcomes with reasons**, never as errors. A refusal is
   the product working. The SDK returns them as results, not exceptions — the UI should
   match.
5. Risk classes always appear with their evidence reachable in one click. Never a bare
   badge.
6. `unknown` is displayed as unknown. Never rounded to a number or a colour implying
   safety.
7. Two trust assumptions — the attestor and the arbiter — are stated where coverage is
   purchased, not hidden in a footer.
8. A stale attestor heartbeat is visible wherever coverage is sold or displayed.
9. `local_upgradeable` always shows its basis. `upgrade_imports` is never displayed as "can
   be upgraded".

---

## Copy expectations

The first screen decides how everything after it is read.

- Do not open with "give your agent a budget, not your keys" or "a spending firewall
  for AI agents". Five comparable products open that way.
- Lead with the measurement and the finding.
- Say *verifiable* and *reproducible*. Never *trustless*.
- Claims need something behind them. Scope comparative statements to what has actually
  been surveyed.
- Recorded exposure is described as what was sent, not as position value. Parametric
  payouts are described as formula output, not as measured loss.

---

## Out of scope for the frontend team

- Classification logic. Consume `@aruna/classifier-core`; never reimplement a check.
- Policy enforcement. The contract decides; the UI reflects.
- Key generation and allowance funding. CLI and owner flows via the SDK.
- Deciding risk thresholds or premium parameters.

## What the frontend team should push back on

If a screen cannot be built because the SDK or indexer does not expose something,
that is a backend gap — raise it rather than working around it with a direct RPC call
or a reimplementation. Two implementations of the same classification is the one
failure mode that would discredit the whole product.
