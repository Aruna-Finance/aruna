//! Shared types, refusal reasons and events for every Aruna contract (docs/CONTRACTS.md).
//! No promises here: the vault links this crate and must import no scanned host function.

pub mod class;
pub mod events;
pub mod reasons;

pub use class::RiskClass;
pub use events::emit;
pub use reasons::Reason;

/// How old a vault's cached class may get before `spend` refuses with `ARUNA_CLASS_STALE`.
/// Also the upper bound on how late a freeze reaches a vault the push missed (docs/ARCHITECTURE.md).
/// About one hour at one block per second. Recorded in docs/DECISIONS.md D-46.
pub const MAX_CLASS_AGE_BLOCKS: u64 = 3_600;

/// Auto-disable (docs/CONTRACTS.md): an agent whose weighted agent-caused refusals within the
/// window reach the threshold is paused. With weights 1/2/4/8, three refusals against `unknown`
/// targets trip it; 24 against `immutable_verified` ones. Recorded in docs/DECISIONS.md D-47.
pub const AUTO_DISABLE_THRESHOLD: u32 = 24;
pub const AUTO_DISABLE_WINDOW_BLOCKS: u64 = 1_200;

/// One day, for the daily cap, in nanoseconds of block time.
pub const DAY_NS: u64 = 86_400 * 1_000_000_000;

/// Agents that can still act (not revoked) per vault. Each carries a gas allowance and state paid
/// from the vault's balance, so the operator must not be able to add them without bound.
/// Recorded in docs/DECISIONS.md D-52.
pub const MAX_AGENTS: u32 = 32;
