//! Class freshness: pull with a staleness bound (docs/DECISIONS.md D-18). `refresh_class` is callable
//! by anyone, including agent keys, and accepts no class as input: it only pulls the registry's value.

use crate::{CachedClass, Vault, VaultExt};
use aruna_common::reasons::panics;
use aruna_common::{emit, RiskClass};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near, require, AccountId, Gas, NearToken};

const GAS_GET_CLASS: Gas = Gas::from_tgas(5);
const GAS_CB_REFRESH: Gas = Gas::from_tgas(10);

/// A callback reachable only from this contract. An agent key also satisfies this check, which is
/// why no `cb_` method may ever appear in an agent key's method list (docs/CONTRACTS.md).
pub(crate) fn assert_self() {
    require!(env::predecessor_account_id() == env::current_account_id(), "ARUNA_CALLBACK_ONLY");
}

#[near]
impl Vault {
    /// Only for targets in the owner's ceiling: an open target list would let anyone grow this vault's
    /// storage, paid from its balance.
    pub fn refresh_class(&mut self, target: AccountId) {
        require!(self.ceiling.allowed_targets.contains(&target), panics::TARGET_NOT_IN_CEILING);
        let args = json!({ "target": target }).to_string();
        let p = env::promise_create(self.registry.clone(), "get_class", args, NearToken::from_yoctonear(0), GAS_GET_CLASS);
        let cb_args = json!({ "target": target }).to_string();
        let cb = env::promise_then(p, env::current_account_id(), "cb_refresh_class", cb_args, NearToken::from_yoctonear(0), GAS_CB_REFRESH);
        env::promise_return(cb);
    }

    /// Stores the registry's record. No record means the registry never classified the target: it is
    /// cached as `unknown`, which no sensible policy allows.
    pub fn cb_refresh_class(&mut self, target: AccountId) -> Option<CachedClass> {
        assert_self();
        // A failed or oversized answer leaves the cache as it was; the bound keeps this callback in gas.
        let record: Option<Value> = match env::promise_result_checked(0, 2_048) {
            Ok(bytes) => serde_json::from_slice(&bytes).ok(),
            Err(_) => return None,
        };
        let (class, frozen, classified_at_block) = match record.as_ref() {
            Some(r) => (
                serde_json::from_value::<RiskClass>(r["class"].clone()).unwrap_or(RiskClass::Unknown),
                r["frozen"].as_bool().unwrap_or(false),
                r["classified_at_block"].as_u64().unwrap_or(0),
            ),
            None => (RiskClass::Unknown, false, 0),
        };
        let cached = CachedClass { class, frozen, classified_at_block, fetched_at_block: env::block_height() };
        emit("class_refreshed", json!({ "target": target, "cached": cached }));
        self.classes.insert(target, cached.clone());
        Some(cached)
    }

    /// Registry only (plan R16, KTD8). Marks a target frozen so the next spend to it is refused with
    /// `ARUNA_TARGET_FROZEN`. A target outside this vault's ceiling is ignored, not an error, because
    /// the registry pushes every freeze to every registered vault.
    pub fn freeze_target(&mut self, target: AccountId) -> bool {
        require!(env::predecessor_account_id() == self.registry, "ARUNA_NOT_REGISTRY");
        if !self.ceiling.allowed_targets.contains(&target) {
            return false;
        }
        let now = env::block_height();
        let mut c = self.classes.get(&target).cloned().unwrap_or(CachedClass { class: RiskClass::Unknown, frozen: true, classified_at_block: 0, fetched_at_block: now });
        c.frozen = true;
        emit("target_frozen", json!({ "target": target, "block": now }));
        self.classes.insert(target, c);
        true
    }
}
