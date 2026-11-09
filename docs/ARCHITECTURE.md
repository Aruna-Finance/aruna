# Architecture

System-level view: what the pieces are, how they connect, and the cross-cutting
concerns that decide whether this survives past a demo.

On-chain detail is in `CONTRACTS.md`. Classification logic is in `CLASSIFIER.md`.
Read `NEAR-FACTS.md` before any contract work — several shapes here are forced by
protocol limits, not chosen.

---

## The layering

Everything hangs off one pure module. This is the single most important structural
decision in the project.

```
@aruna/classifier-core     pure functions, ZERO dependencies, no network, no chain
        ↑
@aruna/rpc                 RpcReader implementations (fetch-based, node-based)
        ↑
@aruna/sdk                 typed client: vault, registry, pool. Signing, errors, retries
        ↑
   ┌────┴──────┬───────────┬────────────┬──────────┐
@aruna/mcp   apps/web      @aruna/attestor  @aruna/cli  @aruna/sim
```

`classifier-core` takes an account id and an injected `RpcReader` and returns a
classification plus its evidence. It never touches the network itself. That inversion
is what lets the same engine run in a browser tab with no libraries, inside an MCP
tool, inside a long-running daemon, and in a batch script over thousands of contracts.

**Adding a dependency to `classifier-core` breaks four consumers.** Treat it as frozen
surface.

### SDK and MCP are not alternatives

An earlier revision framed this as "MCP, not SDK". That was wrong.

An agent has two halves: the half that **decides** (a model, speaking tool calls) and
the half that **executes** (ordinary code that builds transactions, signs, retries,
handles errors). MCP serves the first. The SDK serves the second — and the MCP server
is itself written against the SDK.

For a durable product the SDK is the more fundamental artifact: it is what gets
published, versioned and depended on by third parties. MCP is a thin adapter over it,
and should stay thin enough to rewrite when tooling conventions change.

---

## Components

### TypeScript packages

| Package | Purpose |
|---|---|
| `@aruna/classifier-core` | The engine. Account id + `RpcReader` → class + evidence. Zero deps |
| `@aruna/rpc` | `RpcReader` implementations and a small JSON-RPC client |
| `@aruna/sdk` | Typed client for all three contracts. Key handling, error mapping, staleness refresh |
| `@aruna/mcp` | MCP server. Keyless classifier tools plus vault tools. Thin |
| `@aruna/attestor` | Drift monitor daemon. Four channels, signed reports, heartbeat |
| `@aruna/indexer` | Chain events → database. Backs every history view |
| `@aruna/cli` | Operations and the mainnet class-distribution measurement |
| `@aruna/sim` | Pool solvency simulation |

### Contracts (Rust)

| Contract | Scope | Holds |
|---|---|---|
| `vault` | one per client, deployed by hash | funds, agents, policy, budgets, exposure, cached classes |
| `registry` | shared | classifications, drift reports, challenge windows, attestor bonds, authorized classifiers, vault versions |
| `pool` | shared | underwriter capital, coverage policies, capital adequacy, concentration limits, payouts |
| `factory` | shared | deploys vaults from one global contract by hash, registers them |
| `adapters` | per protocol | translates named actions into target-specific calls |
| `common` | library | shared types, events, error codes across all contracts |

`contracts/common` is not optional. Without it the three contracts grow divergent
definitions of `RiskClass` within weeks.

### Apps

| App | Owner |
|---|---|
| `apps/web` | one static Next.js app: the classifier page at `/`, spec and proof pages, and the dashboards under `/console/` |

Both are handed to a separate team. See `FRONTEND.md` for their role, the questions
each must answer, and what is non-negotiable.

---

## How it connects — the five flows

**1 · Classification**
```
cli | attestor → @aruna/rpc → NEAR RPC (3 view calls)
               → classifier-core → class + evidence
               → @aruna/sdk → registry.set_class()
```
`classifier-core` never reads the chain and never writes. Reading is `rpc`'s job,
writing is the SDK's.

**2 · Agent spend**
```
agent code → @aruna/sdk (or @aruna/mcp) → signs with the agent key
           → vault.spend() → reads its LOCAL class cache
           → adapter builds a promise → target contract
           → cb_settle → exposure recorded → event
```

**3 · Class propagation** — hybrid, see below.

**4 · Drift to claim**
```
attestor detects → sdk → registry.report_drift()
                 → registry pushes the freeze → vaults block the target
                 → challenge window → pool.pay_claim() → transfer to the owner
```
The pool pays the owner directly. The vault is not in the payout path.

**5 · Coverage purchase**
```
owner → console → sdk → pool.buy_coverage()
      → pool reads the target's attestor heartbeat from the registry
      → pool checks capital adequacy and concentration
      → callback → vault stores a coverage reference for display
```
**The pool is the source of truth for coverage and capital**, because only the pool has
the global view needed to enforce concentration limits. The vault holds a reference.

---

## Cross-cutting concerns

### Class freshness — push for freezes, pull for everything else

Pushing every class update to every subscribed vault is O(n) and breaks at a few
hundred vaults. The working model is hybrid:

| Event | Mechanism | Why |
|---|---|---|
| Target frozen after drift | **push** | urgent, rare, must be immediate |
| Routine class update | **pull with a staleness bound** | frequent, not urgent |

The pull works like this: the vault stores `class` with `fetched_at_block`. If that is
older than `MAX_CLASS_AGE`, `spend` returns `ARUNA_CLASS_STALE`, and the SDK calls
`vault.refresh_class(target)` — one cross-contract call to the registry — then retries.

The vault therefore never depends on the registry in the hot path, the staleness bound
is explicit and auditable, and the registry does not need a subscriber list for routine
updates. A vault that misses a freeze push learns of it at its next refresh, so the bound
also caps how late a freeze can arrive.

**State it accurately:** the vault checks the *most recently recorded* class, not a live
chain read. No contract can do a live read.

### Immutability costs upgradeability

**Decided: the vault is immutable, with migration (D-38).** A bug in a deployed vault can
never be patched, and that is the price of the headline claim.

- A new vault version is a new global contract hash. Existing vaults keep running old code,
  forever.
- Migration is an owner action: create a new vault, move funds, re-register agent keys.
- **Migration tooling must ship before any mainnet vault** (release gate A): a CLI command
  and a console flow.
- The registry tracks which vault runs which code hash, so a security finding can be mapped
  to affected vaults and their owners notified.
- The owner can always withdraw, in any state, and each version carries a TVL cap.

### Observability — a silent attestor is the worst failure

An attestor that dies emits nothing. The system looks healthy: no claims arrive,
everything appears fine, and monitoring has simply stopped. This is more dangerous than
a visible outage.

Mitigation: the attestor writes a **heartbeat** on chain. Each target has an assigned
attestor in the registry. The pool refuses to sell new coverage on a target whose assigned
attestor's heartbeat is stale, and the console surfaces it. Absence of signal must be detectable on chain, not only in a dashboard.

### Attestor key rotation

A leaked attestor key must be replaceable without invalidating its past reports.
Registry keeps attestor identity separate from the signing key, with a rotation method
and a record of which key signed which report.

### Versioning

`@aruna/sdk` follows semver and is the compatibility contract for third parties.
Contract ABIs are emitted by `cargo near build` and TypeScript types are generated from
them as a build step — so a changed contract signature breaks the SDK build, which is
exactly what should happen.

### What runs off chain, and why

| Component | Reason |
|---|---|
| Classifier | Its three checks need `view_account`, `view_access_key_list`, `view_code` — all RPC. A contract cannot read another account's state |
| Attestor | Drift detection needs data no contract can read |
| Indexer | History views cannot be rebuilt from RPC on every page load |
| Apps | Ordinary |

What makes the classifier trustworthy is not a trustless claim but **reproducibility**:
anyone can re-run the same checks against the same public data and compare. A wrong
classification is visible to anyone who looks.

---

## Trust assumptions, stated once

Two, and both belong in the README.

1. **The attestor.** Five routes to detecting code change without an outside observer
   were tested and all are closed (`NEAR-FACTS.md` §1). This is permanent under the
   current protocol.
2. **The arbiter.** A contract cannot verify counter-evidence from chain data, so
   disputed drift reports are resolved by a designated arbiter account — at MVP, the
   protocol owner.

At first release Aruna runs both, openly: the daemon is open source and heartbeats and
rulings are public. An attestor independent of Aruna is a condition of coverage on mainnet
(release gate B). A quorum of independent attestors is the path beyond that.

Never describe this system as trustless. The words are *verifiable* and *reproducible*.
