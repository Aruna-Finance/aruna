# Product context

For decisions about what is built and for whom. Technical decisions live in
`ARCHITECTURE.md` and `NEAR-FACTS.md`.

---

## What an AI agent actually is

An agent is **an ordinary program running in a loop that holds a key**. Not a smart
contract. It does not run on chain. It lives on someone's server, in a cloud function,
or in a TEE.

Its anatomy: a trigger (a schedule or an event) → context it reads (prices, balances,
feeds) → a decision (usually one LLM call) → an action (a signed transaction) → a log.

**Aruna does not build the agent. Aruna sits between the agent and the money.** The
agent is written and run by someone else. Aruna's customer is **that person**.

Why agents are dangerous: LLM output is non-deterministic, the context they read is
reachable by attackers (prompt injection through token metadata, feeds, other agents'
messages), they run unattended thousands of times, and they hold a key. A human
re-checks by instinct; an agent approves once and repeats the same assumption forever.

---

## The problem, in three layers

1. **Agents transact autonomously.** One instruction becomes hundreds of transactions
   with no approval in between.
2. **Access keys do not understand economics.** A key can say *who may be called*, not
   *whether the call makes sense*. An agent allowed to call `dex::swap` can trade 1,000
   USDC for a minimum of 1 USDC — valid as access, a disaster as economics.
3. **Limiting is not eliminating.** A whitelisted contract can change under an agent
   that is still perfectly obedient to its policy.

Agent wallets and policy engines address layers 1 and 2. **Aruna's thesis is that layer 3 is
not being measured**, and that measurement must come before risk can be priced or
transferred.

---

## Three layers of product

| Layer | What it does | Stands alone? |
|---|---|---|
| **Measurement** | Classifies every target's mutability, records exposure on chain | yes — this is the product |
| **Protection** | A vault that acts on the classification and contains the agent | yes |
| **Coverage** | Parametric protection against implementation drift | needs both above |

What separates Aruna from existing agent wallets is not the limits — OutLayer and the
Agent API already have those. It is the **chain from policy to
price**: a tighter policy means lower maximum exposure, which means a cheaper premium.
Insurance stops being a patch on losses and becomes the mechanism that makes agents
safer.

---

## Users

| User | What they do | What they carry |
|---|---|---|
| **Client (vault owner)** | Holds the funds, sets the ceiling, withdraws, can remove the operator | Risk outside the covered event; premium if covered |
| **Operator (AaaS company)** | Runs agents for clients. Adds agents within the ceiling, pauses, tightens | The subscription; cannot loosen limits or take funds |
| **Underwriter** | Deposits capital, chooses risk classes | Capital loss on large or correlated claims |
| **Attestor** | Watches targets, reports implementation changes | A slashable bond |
| **Counterparty** | Checks an agent before transacting with it | Nothing — they only read |
| **Any agent developer** | Calls `aruna_check_target` before touching a contract | Nothing — the tool is keyless |

The last two are often forgotten and are what make the measurement layer valuable
outside insurance. An agent's policy and exposure are readable by anyone, without
permission — and the classifier answers questions for agents that never touch Aruna.

## First customer: agent-as-a-service

A company runs agents for clients. The client asks what the guarantee is. The answer is one
URL: a public agent page showing what the agent **cannot** do, enforced by the protocol.
**Here the containment is itself the product.**

**How it works.** One vault per client. The client owns it and holds the funds. The company is
the operator and holds the agent keys, so it runs the service but cannot loosen limits or take
the money. The classifier tells both what the agent's targets can do.

**How Aruna earns.** A subscription per vault, paid by the company, for drift monitoring, alerts
and a branded public page. Billed off chain. The classifier stays free. Coverage margin is
additional revenue once coverage reaches mainnet.

**Other use cases, later:**
- **DAO treasury agent.** Containment shown to members as an on-chain fact.
- **Any agent anywhere.** `aruna_check_target` is free and needs no relationship with Aruna. It
  builds credibility and brings developers in.
- **Solo trader.** Real, but small; spending limits alone nearly suffice.

## Release status

Measurement and the vault come first. **Coverage runs on testnet, with numbers labelled as
assumptions, until drift frequency is measured.** Real funds need the gates below.

## Roadmap and release gates

Everything here is still owed. v0 runs on testnet and holds no real funds.

**Gate A — before a vault holds real funds on mainnet.** All of:
- an independent third-party security audit
- a TVL cap per vault
- one or two agent-as-a-service pilot customers, on capped vaults

**Gate B — before coverage is sold on mainnet.** Gate A, and all of:
- drift frequency measured on mainnet history (open question 1 in `DECISIONS.md`)
- `k` and the concentration limit derived from the simulation and locked; the simulation
  derives a concentration limit of 1.4 x capital against the contract's 2 x, and does not
  identify `k` at all (D-66)
- at least one attestor independent of Aruna
- legal review of whether the product counts as regulated cover where it is sold

Until both pass, coverage runs in full on testnet with its numbers labelled as assumptions.

**Also on the map: a NEP for mutability class.** The `global_by_account` problem is not
Aruna's: it affects every indexer, risk dashboard and agent on NEAR. Solving it at the
standard level is the part of this work most likely to outlive the product.

---

## Four UI surfaces

`FRONTEND.md` carries the role of each surface, the question it must answer, and the short list of
non-negotiables.

**Classifier page.** Static, no wallet, no backend. Paste any account id, see its class
and the evidence. This is the first thing a judge should touch.

**Owner dashboard.** Exposure, agents, targets with class badges, and a panel showing
**how much the premium falls if the policy is tightened**. That panel is the product's
core mechanism; without it the page is only a report.

**Public agent page.** No login. What this agent cannot do, its economic limits,
exposure by class, and the commands anyone can run to verify it themselves. Because
agents are keys on the vault, one `view_access_key_list` call backs the whole page.

**Underwriter view.** The question is not "what did I earn" but **"how concentrated is
the pool's exposure on a single code implementation"**. That number decides whether the
pool survives.

---

## Limits stated openly

Put these in the README; do not wait to be asked.

- **The attestor must be trusted, permanently.** Five routes without a third party were
  tested and all are closed. **The arbiter is a second trust assumption.** Aruna runs both at
  first, openly.
- **`immutable_verified` means no detected upgrade path under the checks listed.** Import
  presence is conservative, so the basis is always shown.
- **An immutable vault cannot be patched.** A bug is remedied by migrating to a new vault.
- **Recorded exposure is not current value.** The vault cannot read the target's state.
- **TOCTOU window ≥ 3 blocks**, a single-shard lower bound. The vault can refuse the
  next transaction, not one in flight.
- **Aruna itself is not covered.** The vault is a central point of failure.
- No guarantee that an agent decides well, no reimbursement for trading losses, no claim
  that any contract is safe, no assumption that every code change is an attack, no
  guarantee the pool always suffices.

## Why NEAR

On NEAR, **an agent's policy is a protocol-level fact rather than a claim.** A restricted
access key is recorded on the account and readable by anyone, and one RPC call verifies it.

Lab results, nearcore 2.14, single-shard sandbox, under the previous gas-key model:

| Tested | Result |
|---|---|
| Agent isolation | Six forbidden actions rejected by the protocol, five before reaching a block |
| Why a vault is required | A restricted key cannot attach a deposit, and NEP-141 requires 1 yoctoNEAR |
| Gas sponsorship | Anyone can fund a gas key; funds cannot be withdrawn. Not used now |
| Readable immutability | The three checks are readable from public chain data |
| TOCTOU window | At least 3 blocks, with receipt order in a block favouring the deploy |
| Invisible code change | For `global_by_account`, executed code changes while `code_hash` does not |

## Positioning

A layer **above** existing custody and policy engines, not a replacement. Do not compete
on agent wallets, spending limits, allowlists, freezes or cross-chain signing — those
are implemented, repeatedly. What does not exist above them is measurement: on-chain
exposure and verifiable target classification.

Against established cover protocols: they insure **protocols** against hacks, with
claims assessed by expert panels. Aruna measures **agent exposure** to mutable
dependencies, with checks that return the same answer whoever runs them.
