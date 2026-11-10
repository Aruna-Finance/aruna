//! Coverage parameters. TESTNET values: short, so one run finishes in one session (plan R32). The
//! economic ones are UNDERWRITING ASSUMPTIONS (plan R8, docs/CONTRACTS.md "Premium"), declared here
//! and returned next to every quote; the simulation (docs/BUILD-PLAN.md stage 8) is what derives
//! them. None of these are safe for funds that matter.

use crate::RiskClass;

/// Blocks after purchase before a change can pay out (anti self-dealing). Testnet.
pub const WAITING_PERIOD_BLOCKS: u64 = 120;
/// Blocks after a report is accepted before a claim on it can pay. Testnet.
pub const CHALLENGE_WINDOW_BLOCKS: u64 = 300;
/// A report's `changed_at_block` must lie in `[report_block - MAX_LOOKBACK_BLOCKS, report_block]`
/// (docs/DECISIONS.md D-23). Testnet.
pub const MAX_LOOKBACK_BLOCKS: u64 = 600;
/// A target's assigned attestor whose last heartbeat is older than this blocks new coverage
/// (docs/DECISIONS.md D-29). Testnet.
pub const HEARTBEAT_STALE_BLOCKS: u64 = 600;
/// After coverage expires, claims may still be filed for this long; capital stays locked. Testnet.
pub const CLAIM_REPORTING_BLOCKS: u64 = 600;
/// Report expiry: a signed report must be submitted within this many blocks of observation.
pub const REPORT_TTL_BLOCKS: u64 = 600;

/// ASSUMPTION. Blocks per day used to turn a coverage window into days for pricing (plan KTD3). Set
/// low on purpose (two-second blocks): fewer blocks per day means more days, so the price errs high.
pub const BLOCKS_PER_DAY: u64 = 43_200;

/// ASSUMPTION. P(event) per 30 days, in basis points, by the target's class. `unknown` is never
/// insurable (docs/DECISIONS.md D-14).
pub const fn p_event_bps_30d(class: RiskClass) -> Option<u32> {
    match class {
        RiskClass::ImmutableVerified => Some(50),
        RiskClass::LocalUpgradeable => Some(500),
        RiskClass::GlobalByAccount => Some(1_000),
        RiskClass::Unknown => None,
    }
}
/// ASSUMPTION. Risk margin on expected loss, in basis points.
pub const RISK_MARGIN_BPS: u32 = 2_000;
/// ASSUMPTION. Capital cost per 30 days, in basis points of the reachable payout.
pub const CAPITAL_COST_BPS_30D: u32 = 100;
/// ASSUMPTION. Capital adequacy `k`: total coverage limits in a book ≤ k × capital, as k × 100.
pub const K_X100: u128 = 500;
/// ASSUMPTION. Concentration: limits on one resolved code hash, or one upgrade authority, ≤ this
/// many basis points of the book's capital (docs/DECISIONS.md D-24).
pub const CONCENTRATION_BPS: u128 = 20_000;
