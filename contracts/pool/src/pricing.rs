//! The premium (plan R7, R8, R9; docs/CONTRACTS.md "Premium"). Per-target coverage, so the inputs are
//! the target's class, the sum insured `C`, the payout ratio, the window, and the agent's daily cap in
//! the coverage's token. `max_per_tx` is not an input; `max_risk_class` only gates the purchase.
//!
//!   days      = ceil(window_blocks / BLOCKS_PER_DAY) + 1        UTC days the window can touch (KTD3)
//!   reachable = min(daily_cap × days × ratio, C)                 the most this coverage can pay
//!   EL        = reachable × P(event | class) × days / 30
//!   premium   = EL + EL × margin + reachable × capital_cost × days / 30
//!
//! Every term is proportional to `reachable`, so two quotes that differ only in `daily_cap` differ by
//! the ratio of their reachable payouts. All inputs and declared parameters come back with the price.

use aruna_common::params::{p_event_bps_30d, BLOCKS_PER_DAY, CAPITAL_COST_BPS_30D, RISK_MARGIN_BPS};
use aruna_common::RiskClass;
use near_sdk::json_types::U128;
use near_sdk::near;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Quote {
    pub class: RiskClass,
    pub limit: U128,
    pub payout_ratio_bps: u16,
    pub window_blocks: u64,
    pub daily_cap: U128,
    pub days: u64,
    pub reachable_payout: U128,
    pub expected_loss: U128,
    pub premium: U128,
    /// Declared underwriting assumptions, labelled as such.
    pub assumptions: Assumptions,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Assumptions {
    pub label: String,
    pub p_event_bps_30d: u32,
    pub risk_margin_bps: u32,
    pub capital_cost_bps_30d: u32,
    pub blocks_per_day: u64,
}

pub fn days_touched(window_blocks: u64) -> u64 {
    window_blocks.div_ceil(BLOCKS_PER_DAY) + 1
}

/// None when the class is not insurable (`unknown`, docs/DECISIONS.md D-14).
pub fn quote(class: RiskClass, limit: u128, payout_ratio_bps: u16, window_blocks: u64, daily_cap: u128) -> Option<Quote> {
    let p = p_event_bps_30d(class)?;
    let days = days_touched(window_blocks);
    let reachable = (daily_cap * days as u128 * payout_ratio_bps as u128 / 10_000).min(limit);
    let el = reachable * p as u128 * days as u128 / (30 * 10_000);
    let margin = el * RISK_MARGIN_BPS as u128 / 10_000;
    let capital = reachable * CAPITAL_COST_BPS_30D as u128 * days as u128 / (30 * 10_000);
    Some(Quote {
        class,
        limit: U128(limit),
        payout_ratio_bps,
        window_blocks,
        daily_cap: U128(daily_cap),
        days,
        reachable_payout: U128(reachable),
        expected_loss: U128(el),
        premium: U128(el + margin + capital),
        assumptions: Assumptions {
            label: "UNDERWRITING ASSUMPTIONS, testnet: not derived from measured drift frequency".into(),
            p_event_bps_30d: p,
            risk_margin_bps: RISK_MARGIN_BPS,
            capital_cost_bps_30d: CAPITAL_COST_BPS_30D,
            blocks_per_day: BLOCKS_PER_DAY,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const NEAR: u128 = 10u128.pow(24);

    #[test]
    fn a_tighter_daily_cap_lowers_the_premium_by_the_ratio_of_reachable_payouts() {
        // Covers AE1: C = 10 NEAR, ratio 80%, a 5-day window touching 6 UTC days.
        let window = 5 * BLOCKS_PER_DAY;
        assert_eq!(days_touched(window), 6);
        let loose = quote(RiskClass::LocalUpgradeable, 10 * NEAR, 8_000, window, 5 * NEAR).unwrap();
        let tight = quote(RiskClass::LocalUpgradeable, 10 * NEAR, 8_000, window, NEAR).unwrap();
        assert_eq!(loose.reachable_payout, U128(10 * NEAR));
        assert_eq!(tight.reachable_payout, U128(48 * NEAR / 10));
        assert_ne!(loose.premium, tight.premium);
        assert_eq!(tight.premium.0 * 100 / loose.premium.0, 48);
    }

    #[test]
    fn max_per_tx_is_not_an_input() {
        // Covers AE2: the function has no such parameter; two policies differing only in it quote alike.
        let a = quote(RiskClass::LocalUpgradeable, 10 * NEAR, 8_000, BLOCKS_PER_DAY, NEAR).unwrap();
        let b = quote(RiskClass::LocalUpgradeable, 10 * NEAR, 8_000, BLOCKS_PER_DAY, NEAR).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn unknown_is_not_insurable() {
        assert!(quote(RiskClass::Unknown, NEAR, 8_000, 100, NEAR).is_none());
    }

    #[test]
    fn a_riskier_class_costs_more() {
        let l = quote(RiskClass::LocalUpgradeable, 10 * NEAR, 8_000, BLOCKS_PER_DAY, NEAR).unwrap();
        let g = quote(RiskClass::GlobalByAccount, 10 * NEAR, 8_000, BLOCKS_PER_DAY, NEAR).unwrap();
        assert!(g.premium.0 > l.premium.0);
    }

    #[test]
    fn a_window_inside_one_day_touches_two() {
        assert_eq!(days_touched(1), 2);
        assert_eq!(days_touched(BLOCKS_PER_DAY), 2);
        assert_eq!(days_touched(BLOCKS_PER_DAY + 1), 3);
    }
}
