//! Exposure history (plan R22): what passed through the vault to a target, by agent and token, as
//! checkpoints the pool can read at any earlier block. Recorded exposure is what was SENT, not the
//! position's current value (docs/PRODUCT.md, "Limits stated openly").

use crate::{Exposure, Vault, VaultExt};
use aruna_common::{RiskClass, TokenId};
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, PublicKey};

impl Vault {
    /// Adds a settled amount to the running total and appends a checkpoint at this block.
    pub(crate) fn record_exposure(&mut self, agent: &PublicKey, target: &AccountId, token: &TokenId, amount: u128, class: RiskClass) -> u128 {
        let now = env::block_height();
        let key = (target.clone(), token.clone());
        let mut e = self.exposure.get(&key).cloned().unwrap_or(Exposure { amount: U128(0), class_at_record: class, first_seen: now, last_updated: now });
        e.amount = U128(e.amount.0 + amount);
        e.class_at_record = class;
        e.last_updated = now;
        let total = e.amount.0;
        self.exposure.insert(key, e);

        let ck = (agent.clone(), target.clone(), token.clone());
        let mut points = self.checkpoints.get(&ck).cloned().unwrap_or_default();
        let cumulative = points.last().map(|(_, c)| *c).unwrap_or(0) + amount;
        match points.last_mut() {
            Some((b, c)) if *b == now => *c = cumulative,
            _ => points.push((now, cumulative)),
        }
        self.checkpoints.insert(ck, points);
        total
    }
}

#[near]
impl Vault {
    /// Exposure this agent recorded to `target` in `token` at blocks strictly before `block`.
    pub fn exposure_before(&self, agent: PublicKey, target: AccountId, token: TokenId, block: u64) -> U128 {
        let points = self.checkpoints.get(&(agent, target, token));
        let Some(points) = points else { return U128(0) };
        let idx = points.partition_point(|(b, _)| *b < block);
        U128(if idx == 0 { 0 } else { points[idx - 1].1 })
    }

    /// Every checkpoint for one agent, target and token: (block, cumulative amount).
    pub fn get_checkpoints(&self, agent: PublicKey, target: AccountId, token: TokenId) -> Vec<(u64, U128)> {
        self.checkpoints.get(&(agent, target, token)).map(|p| p.iter().map(|(b, c)| (*b, U128(*c))).collect()).unwrap_or_default()
    }
}
