# Contract review, v0 — 10 November 2026

Internal review of `contracts/vault` (with `contracts/common`), and of `contracts/factory` and
`contracts/registry` as its callers, using the `near-contract-audit` checklist. **This is not the
independent third-party audit release gate A requires** (`docs/BUILD-PLAN.md`); it was done by the
same people and tools that wrote the code.

## Findings

| # | Severity | Where | Finding | Status |
|---|---|---|---|---|
| H1 | High | `vault/src/roles.rs`, `vault/src/agents.rs` | Owner-only and power-granting methods accepted calls from any key of the owner's or operator's account, including a function-call key granted to a dApp. A leaked one could change the owner. | **Fixed**: `set_owner`, `set_operator`, `set_ceiling`, `withdraw_to_owner`, `resume_agent`, `add_agent`, `update_policy` require exactly 1 yoctoNEAR, which a function-call key cannot attach. Pause and revoke do not, so stopping an agent is never harder than starting one |
| M1 | Medium | `vault/src/class_cache.rs` | `refresh_class` accepted any target, so anyone could grow the vault's storage, paid from its balance | **Fixed**: only targets in the owner's ceiling |
| M2 | Medium | `vault/src/agents.rs` | The operator could add agents without bound (a daily cap of 0 fits any ceiling), each carrying a gas allowance and state paid by the vault | **Fixed**: at most `MAX_AGENTS` (32) agents that are not revoked (D-52) |
| L1 | Low | `vault/src/spend.rs` `available()` | Subtracts in-flight reservations from the balance, although an attached deposit likely leaves the balance when the receipt is created. Errs toward refusing (`ARUNA_INSUFFICIENT_BALANCE`) under parallel load; never toward overspending | Open: measure before changing |
| L2 | Low | `vault/src/spend.rs` `cb_settle` | A settlement after midnight added to the previous day's total, which the next check then reset | **Fixed**: `cb_settle` rolls the day first |
| I1 | Info | `vault/src/spend.rs` | `Exposure.class_at_record` keeps only the latest class per target | Stage 5: exposure checkpoints |
| I2 | Info | several | `u64` block heights in JSON | Acceptable: far below 2^53 |

## Checked and holding

- `cb_settle` and `cb_refresh_class` require `predecessor == current_account_id`; agent keys, which
  also pass that check, are kept out by `method_names` (sandbox: `MethodNameMismatch` for both).
  The factory's callback uses `#[private]`.
- The daily cap is checked and reserved in one receipt; 10 parallel spends against a 2 NEAR cap
  settled exactly 2 NEAR.
- Callbacks read promise results with a length bound and do not panic on a failed or oversized
  result, so a reservation cannot be stranded.
- Funds leave only through `withdraw_to_owner` (to the owner) and the `swap` adapter (whose target
  pays back its caller); no method takes a receiver argument.
- Distinct storage prefixes; `#[init]` on every initializer; `overflow-checks = true` in release.
- The compiled vault imports none of the host functions the classifier scans.

## Testnet vaults and these fixes

`demo.factory.arunafi.testnet` runs the first vault version (`5s1ggtt…`), before H1, M1, M2 and L2
were fixed. Vaults are immutable, so it keeps them; it holds no real value. The fixed version
(`4hDwnc…`, `contracts/vault/res/aruna_vault-v2.wasm`) was published on 10 November 2026 and runs
`demo2.factory.arunafi.testnet`, the vault the agent examples in `examples/` use
(`docs/SELF-CLASSIFICATION.md`). A vault holding funds must run a version that includes these fixes.

---

# Coverage review — 11 November 2026

Scope: whether the coverage loop is right end to end against the product design, and critical bugs
(funds stranded, paid twice or to the wrong party, access control). Not performance or style. One
reviewer, no subagents, on `contracts/pool`, `contracts/registry`, `contracts/vault` and the SDK and
attestor paths that feed them. Not an independent audit (docs/BUILD-PLAN.md gate A still requires one).

| # | Severity | Finding | Status |
|---|---|---|---|
| C1 | Critical | A panic in `cb_buy` (short window, overflowing limit or daily cap) stranded the NEAR premium already sent | **Fixed** (D-63): refusals that return it; pricing saturates |
| C2 | Critical | An agent with no daily cap in a token priced at zero, and the window was unbounded: free coverage that locked the book's capital and capacity for as long as the buyer liked | **Fixed** (D-63): cap and premium must be non-zero, window at most 30 days, ratio 1..=10000 bps |
| C3 | Critical | `claim` is open to anyone and set `claim_in_flight` before its callbacks; too little gas left a coverage unclaimable forever | **Fixed** (D-63): 150 Tgas up front, a stuck claim expires after 100 blocks |
| C4 | Critical | One change could be paid twice: two agreeing reports, or two changes counting the same exposure | **Fixed** (D-62): `paid_through_block` |
| H1 | High | Ruling on one report of a dispute left the other Disputed forever: `lift_freeze` blocked, and a rejection unfroze a target whose other report still stood | **Fixed** (D-61) |
| M1 | Medium | A deposit that rounds to zero shares was accepted and credited to nobody | **Fixed**: `ARUNA_DEPOSIT_TOO_SMALL` |
| M2 | Medium | An upheld ruling does not penalize the disputing attestor under the old rule; a frivolous dispute cost nothing | **Fixed** with H1: the loser is slashed |
| L1 | Low | Buying checks the vault owner recorded at registration, not its current owner, so an ownership change leaves the old owner as the only buyer and payee | Open, noted |
| L2 | Low | A payout to an account that cannot receive it (deleted, or not registered at the token) is marked paid and leaves the funds unaccounted in the pool | Open: needs a payout callback |
| L3 | Low | Coverage records live in the pool's storage, paid from its balance, not by buyers | Open: charge a storage deposit before mainnet |
| I1 | Info | Anyone may file a report against any target and freeze it for every vault until the arbiter rules or the owner lifts it. The single-attestor power D-59 states, bounded by the bond | Accepted trade-off, in the README |

Checked and holding: funds leave a vault only to the owner or through a named adapter, and an agent
key reaches neither `withdraw_to_owner` nor a callback; `cb_settle` never panics and releases every
reservation, for NEAR and for a token that used only part of an amount; a token purchase whose
callback fails is refunded by the token's own `ft_resolve_transfer`; payouts are `min(exposure ×
ratio, remaining C)` from the coverage's own book, so a USDC claim never touches NEAR capital;
reports are signed over every field, replays are refused by nonce, and a loosened policy voids a claim;
the SDK resolves refusals and throws only authorization and transport failures.

Each fix has a regression test in `contracts/pool/src/tests.rs` or `contracts/registry/src/tests_drift.rs`,
and the nine sandbox tests (including the NEAR, USDC and dispute loops) pass. The pool on testnet
(`pool.arunafi.testnet`) predates these fixes and, because they change its stored records, needs a
fresh pool; the registry's logic can be redeployed in place.

