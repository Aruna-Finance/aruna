# Testing

## The lab — do not modify

`lab/` holds protocol tests already run on nearcore 2.14, protocol 88, single-shard
sandbox. Results are recorded in `NEAR-FACTS.md`.

The lab is **experimental evidence**, not evolving code. You may add tests; you may not
change existing tests or results. If a finding turns out to be wrong, add a new test and
update NEAR-FACTS with a note saying what changed and why.

Re-running:

```bash
cd lab
(cd contracts/<c> && cargo near build non-reproducible-wasm --no-abi)   # gate, usdc, funder, target
# target twice: default → target_v1.wasm, --features v2 → target_v2.wasm
cargo run -p harness --release -- [t0|t1|t2|t3|t4|all]
```

Raw output lands in `results/*.json`.

Blockers already found, so they are not rediscovered:

- `near-sandbox` 0.3.12 pins nearcore 2.13. Use 0.4.x for 2.14.
- `near-sdk` 5.30 and `near-primitives` 0.38 need rustc ≥ 1.95.
- `near-api` 0.8.7 can only **read** gas keys. We no longer depend on gas keys.
- `near-cli-rs` needs ≥ 0.31.0-rc.2 for gas-key commands.

### Lab tests T5–T9 — recorded 9 November 2026

The lab exercised `GasKeyFunctionCall` on sub-accounts. The product uses classic function-call
keys on a contract account, so these were owed before the affected claims stood. All five ran in
`lab/owed/` and are recorded in `NEAR-FACTS.md` §10:

```bash
(cd lab/owed/contracts/<c> && cargo near build non-reproducible-wasm --no-abi)   # fconly, keymgr, keymgr_promise
cargo run --release --manifest-path lab/owed/Cargo.toml -- [t5|t6|t7|t8|t9|all]
```

The original definitions:
`lab/results/t5_current_contract_code.json` already uses the name t5: give the new harness
commands and result files different names so existing results stay untouched.

| Test | What it establishes |
|---|---|
| **T5** | A function-call key attempts `UseGlobalContract` on an account by hash → expect rejection; record the exact error. `D-08` and self-classification depend on it |
| **T6** | A classic function-call key with an `allowance` on a contract account: gas paid from the account balance, behaviour at exhaustion |
| **T7** | A contract with **no full-access key** adds and deletes its own function-call keys by promise, and a contract importing only the function-call AddKey host function cannot add a full-access key. **Also list compiled imports with `cargo near build`, for `Promise` against low-level** |
| **T8** | An agent key attempts every `cb_` method → expect `MethodNameMismatch` |
| **T9** | Whether a contract that can `delete_account` lets a parent recreate the account with other code — the open hole in the immutability claim |

---

## Layers

| Layer | Tool | For |
|---|---|---|
| Unit | `vitest` / `cargo test` | Pure logic: WASM import parsing, premium maths, state transitions |
| Property | `fast-check` / proptest | Invariants under random action sequences |
| Contract integration | `near-workspaces` | Multi-transaction flows, callbacks, cross-contract |
| Action level | sandbox directly | Key permissions and account actions |
| End to end | testnet | The demo judges verify |

Use action-level tests, not `near-workspaces`, for anything testing key permissions:
the subject is a protocol action, not contract logic.

---

## Invariants — run these under random action sequences

Veto runs 1,000 random actions against its invariants. Ours are richer, so this earns
more. Each must hold after every action in any order:

```
no authorization makes spent_today + reserved exceed the cap in force at that moment
Σ daily caps of a vault's agents ≤ the owner's ceiling
Σ exposure(target) ≤ cumulative amount sent to that target
Σ active coverage ≤ k × pool capital
Σ coverage exposed to any single code hash ≤ concentration limit
no payout exists whose challenge window has not closed, or whose report is disputed
no refused call changes balance, spent_today, reserved or exposure
no operator action increases any limit, or moves funds
no exposure row references a target with no classification record
a Revoked agent has no key on the vault
```

The last one couples contract state to protocol state; assert it against
`view_access_key_list`. A later cap reduction may leave the running total above the new cap;
that is correct behaviour. Funds returning from a target do not reduce exposure.

---

## Required tests

### Classifier
Four fixtures, one per class, plus the cases that catch the common mistakes:

- by hash + **function-call keys present** + clean imports → `immutable_verified`
- by hash + no full-access keys + **a deploy import** → `local_upgradeable`, basis
  `upgrade_imports`
- by hash + no full-access keys + **a delete-account import** → `local_upgradeable`
- by hash + no full-access keys + **a full-access gas key import** → `local_upgradeable`
- local code + a full-access key + scanned imports → basis `full_access_key`
- local code + no keys + clean imports → `local_upgradeable`, basis `own_code`
- by hash + **a full-access key** → `local_upgradeable`
- references another account's global contract → `global_by_account`
- unparseable WASM → `unknown`
- an account with no contract → `unknown`, and specifically **not** confused with a
  global-contract account, since both report a zero `code_hash`

### The invisible drift case
The most important single test. The owner redeploys a global contract. Assert:
`view_account.code_hash` **unchanged**, `view_code.hash` **changed**, executed
behaviour changed, and the classifier still detects it through the correct channel.

### Agent isolation
Six forbidden actions from an agent key, each with its expected error. Five never reach
a block — assert on the RPC error, not on a transaction outcome.

### The callback footgun
Construct an agent key and attempt **every** method whose name begins `cb_`. All must be
rejected with `MethodNameMismatch`. Also assert statically that no `cb_` name appears in
any agent key's method list.

### Reservation accounting
**Must be parallel.** Fire ten concurrent requests that jointly exceed the daily cap and
assert the total that passed does not exceed it. A serial test passes a broken
implementation — that is exactly the bug being hunted.

### Class re-validation at execution
Set a policy allowing a target, change that target's recorded class, refresh the vault's
cache, then attempt a spend. Expect the outcome `Blocked` with `ARUNA_RISK_CLASS_NOT_ALLOWED`.

### Refusals persist
Trigger each policy refusal. Assert it **returns** rather than panics and that its event was
emitted. An unregistered key must **panic**, leaving no state change.

### Class freshness
A cache past `MAX_CLASS_AGE` returns `ARUNA_CLASS_STALE` and does not touch the refusal counter.
`refresh_class` clears it, and accepts no class as input. A vault that missed a freeze push
learns of it at refresh.

### Owner and operator
Every action in the table in `CONTRACTS.md`, from each role. The operator cannot loosen a policy,
resume an agent, exceed the ceiling by adding agents, withdraw, or change the owner. The owner can
remove the operator. Adapter proceeds return to the vault.

### No full-access key
List the vault's keys and compiled imports. Assert no full-access key and none of the scanned
host functions.

### Revocation
Revoke an agent, then submit with its key. The **network** must reject it; the
transaction must never execute.

### Auto-disable
Drive refusals against targets of different classes and assert the weighted threshold
triggers at the right point, with the `agent_auto_disabled` event. Assert frozen, stale and
reclassified refusals do **not** count, and only the owner can resume.

### Failed callback
A failing promise releases the reservation, leaves `spent_today` unchanged and records
no exposure.

### Attestation
Forged, expired, replayed and swapped reports, `changed_at_block` outside the lookback bound,
and equal resolved hashes. These assert the bound is enforced; none "proves backdating is
impossible". Conflicting reports create `Disputed`, with no payout until the arbiter rules. Share
one golden vector between Rust and TypeScript.

### Heartbeat
A stale heartbeat from a target's assigned attestor blocks new coverage on that target, and only
that target.

### Payout
`min(recorded exposure × ratio, limit)` with edge cases: zero exposure, exposure above
the limit, expired coverage, and exposure recorded **after** the claimed event block. The pool
rejects an exposure answer from a vault not registered by the factory.

---

## What a judge must be able to run

The README carries numbered steps, each with an expected result. Claude Code and Codex
will run them.

1. Open the classifier page and paste a given mainnet account → see its class and
   evidence, no wallet
2. One command reproduces the class distribution measurement from raw data
3. One command sets up testnet accounts and deploys the vault
4. One command runs the isolation demo and prints six refusals
5. One command runs the honest example agent through the vault
6. One command runs the injected agent and shows the refusals and the auto-disable
7. One command triggers drift on our own target contract and runs the claim through to
   payout
8. One command rebuilds every simulation chart from raw data

No step may require the author's private key, a paid API key, or any state that cannot
be reproduced.

---

## Before submission

- [x] The `near-contract-audit` skill run against `contracts/vault` (`docs/AUDIT-v0.md`)
- [ ] No keys or `.env` anywhere in git history
- [ ] Every claim in the README has a command that proves it
- [ ] The demo runs on testnet from a freshly cloned repo, not from the author's machine
- [ ] Testnet's protocol version checked, and gas costs re-measured there
- [ ] `classifier-core` still has zero dependencies
- [x] `lab/` results match `NEAR-FACTS.md`, and T5–T9 are recorded
