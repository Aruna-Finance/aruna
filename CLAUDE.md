# Aruna — project context

**Aruna measures whether the contracts an agent touches can still change — and found a
class that can change invisibly to the method everyone uses.**

That sentence is the project. Everything else exists to make it true, usable and
actionable. Read `docs/COMPETITIVE.md` before writing product code: five comparable
projects already shipped the thing Aruna is *not*.

Three layers, built in this order: **Measurement** (classify targets, record exposure),
**Protection** (a vault that acts on the classification), **Coverage** (parametric
protection against implementation drift).

A product, not a hackathon entry. The first paying customer is an **agent-as-a-service
company**: one vault per client, the client as owner, the company as operator.
**14 November 2026, 23:59 UTC** is the NEAR HACKATHON deadline and the date of public
release v0. Where the two conflict, say so rather than quietly choosing the demo.

---

## Hard rules

Break one and the output is unusable.

1. **Never invent** a contract address, SDK method name, host function, RPC shape or
   gas cost. Check `docs/NEAR-FACTS.md`, then `docs.near.org/llms.txt`, or measure it.
   If you cannot verify it: **stop and say so.**
2. **Read `docs/NEAR-FACTS.md` before any contract code.** It records what our lab
   proved, including five things that are **impossible** on NEAR.
3. **Testnet only** for transactions, until the release gates in `docs/BUILD-PLAN.md`
   pass. The classifier reads mainnet state read-only.
4. **Never commit keys, seed phrases or `.env`.** Only `.env.example`.
5. **The vault is never a generic executor.** Named actions with per-protocol adapters
   only. A free-form path destroys containment entirely.
6. **Never call this system trustless.** There are two trust assumptions — the attestor
   and the arbiter. Use *verifiable* and *reproducible*.
7. **Never modify `lab/`.** Experimental evidence already run. Add tests; do not change
   results.
8. **`@aruna/classifier-core` has zero dependencies.** Adding one breaks four
   consumers. Treat it as frozen surface.
9. **Policy refusals return; authorization failures panic.** A panic reverts state, so
   a refusal that panics cannot increment a counter or emit an event. See
   `docs/CONTRACTS.md`.
10. **Never reimplement a classification check.** One engine, consumed everywhere. Two
    implementations would discredit the product.
11. **A vault has no full-access key, and its code never uses near-sdk's `Promise`.** Use
    the low-level `env::promise_batch_*` functions. `Promise` links upgrade imports the
    vault must not carry, measured in `docs/NEAR-FACTS.md` §4.

---

## Stack and pinned versions

| Part | Choice | Note |
|---|---|---|
| Contracts | Rust, `near-sdk` 5.30 | rustc ≥ 1.95 |
| Sandbox | `near-sandbox` 0.4.x → nearcore 2.14 → protocol 88 | 0.3.12 pins 2.13; do not use |
| Primitives | `near-primitives` 0.38 | |
| CLI | `near-cli-rs` ≥ 0.31.0-rc.2 | |
| TypeScript | pnpm workspace | |
| Apps | Next.js | owned by a separate team, see `docs/FRONTEND.md` |

**Gas keys (NEP-611) are not used.** Agents are function-call keys on the vault with a
classic `allowance`, so there is no `TransferToGasKey`, no TransactionV1 and no
dependency on patchy library support. See `docs/DECISIONS.md` D-02.

---

## Repo layout

```
packages/
  classifier-core/   @aruna/classifier-core   pure, zero deps. The engine
  rpc/               @aruna/rpc               RpcReader implementations
  sdk/               @aruna/sdk               typed client; the compatibility contract
  mcp/               @aruna/mcp               MCP server; thin adapter over the SDK
  attestor/          @aruna/attestor          drift monitor daemon, heartbeat
  indexer/           @aruna/indexer           chain events → database
  cli/               @aruna/cli               ops and the mainnet measurement
  sim/               @aruna/sim               pool solvency simulation
apps/
  web/               one static Next.js app: classifier page, spec, proof, /console/
contracts/
  common/            shared types, events, error codes
  vault/             one per client, deployed by hash, no full-access key
  registry/          shared: classes, drift reports, bonds, vault versions
  pool/              shared: capital, coverage, concentration, payouts
  factory/           deploys vaults
  adapters/          per-protocol action translators
fixtures/            four test contracts, one per risk class
examples/            honest-agent.ts, injected-agent.ts
lab/                 sandbox evidence. DO NOT MODIFY
docs/
```

---

## Which doc before which task

| Working on | Read first |
|---|---|
| Anything, first time | `docs/COMPETITIVE.md`, then `docs/ARCHITECTURE.md` |
| Any contract code | `docs/NEAR-FACTS.md`, `docs/CONTRACTS.md` |
| Classifier or its surfaces | `docs/CLASSIFIER.md` |
| SDK, or anything consuming contracts | `docs/SDK.md` |
| MCP tools | `docs/MCP.md` |
| Attestor, claims, challenge window | `docs/ATTESTOR.md` |
| Apps | `docs/FRONTEND.md` |
| Scope or ordering | `docs/BUILD-PLAN.md` |
| Questioning a design choice | `docs/DECISIONS.md` — probably settled |
| Tests | `docs/TESTING.md` |
| NEAR skills and official sources | `docs/NEAR-SKILLS.md` |
| Product, users, positioning | `docs/PRODUCT.md` |

---

## Conventions

- Code, comments and README in English.
- Contract errors prefixed `ARUNA_`. The canonical reason list is in `docs/CONTRACTS.md`.
  SDK reason codes are the same names without the prefix; a test asserts the sets match.
- Callback methods are prefixed `cb_` and must never appear in an agent key's
  `method_names`. A test enforces this.
- All amounts are `U128` in the token's smallest unit. Never floats.
- Every state-changing function emits a NEP-297 event with `standard: "aruna"`.
- Contract ABIs from `cargo near build` generate TypeScript types as a build step.
- Integration tests use `near-workspaces`; action-level tests use the sandbox directly,
  because they test protocol actions rather than contract logic.
- Invariant tests are not optional. See `docs/TESTING.md`.

## Definition of done

A stage is done when its acceptance criteria in `docs/BUILD-PLAN.md` are green, a
stranger can follow the README's numbered "do X, see Y" steps, and **no claim in the
README lacks a command that proves it.**

## For the judges

Initial screening is by Claude Code and Codex: they check the project runs and does
what the README says. Write for a machine reader — numbered steps, each with an
expected result, no marketing. Public repo, MIT LICENSE, before the deadline.
