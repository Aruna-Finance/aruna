use crate::{pricing, Book, Coverage, Pool, PoolExt, Quote};
use aruna_common::{RiskClass, TokenId};
use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

#[near]
impl Pool {
    /// The premium for these inputs, with every input and declared assumption (plan R9). Free.
    pub fn quote(&self, class: RiskClass, limit: U128, payout_ratio_bps: u16, window_blocks: u64, daily_cap: U128) -> Option<Quote> {
        pricing::quote(class, limit.0, payout_ratio_bps, window_blocks, daily_cap.0)
    }

    pub fn get_book(&self, token: TokenId) -> Book {
        self.book(&token)
    }

    pub fn get_coverage(&self, id: u32) -> Option<Coverage> {
        self.coverages.get(id).cloned()
    }

    pub fn coverage_count(&self) -> u32 {
        self.coverages.len()
    }

    pub fn get_shares(&self, underwriter: AccountId, token: TokenId) -> U128 {
        U128(self.shares.get(&(underwriter, token)).copied().unwrap_or(0))
    }

    pub fn registry(&self) -> AccountId {
        self.registry.clone()
    }
}
