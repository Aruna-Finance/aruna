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
