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
