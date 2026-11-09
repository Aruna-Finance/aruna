//! The spend flow (docs/CONTRACTS.md "The `spend` flow"), in its documented order.
//!
//! Policy refusals RETURN `Blocked { reason }` and persist their event and counter; authorization
//! failures panic (CLAUDE.md rule 9). The daily cap uses reservation accounting, checked and reserved
//! in the same receipt, so parallel requests cannot jointly pass it (docs/DECISIONS.md D-16).
//!
//! One adapter in v0, `swap`: a named action, never a generic executor (CLAUDE.md rule 5). It calls
//! `swap(min_amount_out)` on the target with the amount attached; the target pays its output back to
//! its caller, the vault. The adapter has no argument that names a receiver.

use crate::class_cache::assert_self;
use crate::{AgentStatus, Exposure, Vault, VaultExt};
use aruna_common::reasons::panics;
use aruna_common::{emit, Reason, RiskClass, AUTO_DISABLE_THRESHOLD, AUTO_DISABLE_WINDOW_BLOCKS, DAY_NS, MAX_CLASS_AGE_BLOCKS};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PromiseError, PublicKey};

const GAS_SWAP: Gas = Gas::from_tgas(20);
const GAS_CB_SETTLE: Gas = Gas::from_tgas(15);
pub const ADAPTERS: &[&str] = &["swap"];

#[near(serializers = [json])]
#[serde(tag = "outcome")]
#[derive(Debug, PartialEq)]
pub enum SpendOutcome {
    /// Sent; settlement happens in `cb_settle`.
    Allowed { amount: U128, class: RiskClass },
    /// Refused by policy. Nothing was sent; the refusal is recorded.
    Blocked { reason: Reason, class: Option<RiskClass> },
}

impl Vault {
    fn today() -> u64 {
        env::block_timestamp() / DAY_NS
    }

    /// Balance a new spend may use: total minus storage staking minus everything in flight.
    fn available(&self) -> u128 {
        let storage = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128;
        env::account_balance().as_yoctonear().saturating_sub(storage).saturating_sub(self.reserved_total)
    }

    /// Records a refusal, counts it toward auto-disable when the reason is agent-caused, and returns it.
    fn refuse(&mut self, key: &PublicKey, target: &AccountId, reason: Reason, class: Option<RiskClass>) -> SpendOutcome {
        let height = env::block_height();
        emit(
            "execution_rejected",
            json!({ "agent": key, "target": target, "reason": reason, "class": class, "block": height }),
        );
        if reason.counts_toward_auto_disable() {
            let weight = class.unwrap_or(RiskClass::Unknown).refusal_weight();
            let agent = self.agent_mut(key);
            agent.refusals.retain(|(b, _)| height.saturating_sub(*b) < AUTO_DISABLE_WINDOW_BLOCKS);
            agent.refusals.push((height, weight));
            let total: u32 = agent.refusals.iter().map(|(_, w)| w).sum();
            if total >= AUTO_DISABLE_THRESHOLD && agent.status == AgentStatus::Active {
                agent.status = AgentStatus::Paused;
                agent.auto_disabled = true;
                emit("agent_auto_disabled", json!({ "agent": key, "weighted_refusals": total, "window_blocks": AUTO_DISABLE_WINDOW_BLOCKS }));
            }
        }
        SpendOutcome::Blocked { reason, class }
    }

    /// Steps 0–8. Returns the outcome; on `Allowed` the reservation is already taken.
    fn check_and_reserve(&mut self, key: &PublicKey, adapter: &str, target: &AccountId, amount: u128, min_amount_out: u128) -> SpendOutcome {
        // 0. a registered key, and the agent may act
        let agent = self.agents.get(key).unwrap_or_else(|| env::panic_str(panics::UNKNOWN_AGENT)).clone();
        require!(ADAPTERS.contains(&adapter), "ARUNA_UNKNOWN_ADAPTER");
        let cached = self.classes.get(target).cloned();
        let class = cached.as_ref().map(|c| c.class);
        match agent.status {
            AgentStatus::Active => {}
            _ if agent.auto_disabled => return self.refuse(key, target, Reason::AgentAutoDisabled, class),
            _ => return self.refuse(key, target, Reason::AgentNotActive, class),
        }
        let p = &agent.policy;
        // 1. target in policy
        if !p.allowed_targets.contains(target) {
            return self.refuse(key, target, Reason::TargetNotAllowed, class);
        }
        // 2–3. a recorded class, not frozen, fetched recently enough
        let Some(cached) = cached else {
            return self.refuse(key, target, Reason::ClassStale, None);
        };
        if cached.frozen {
            return self.refuse(key, target, Reason::TargetFrozen, class);
        }
        if env::block_height().saturating_sub(cached.fetched_at_block) > MAX_CLASS_AGE_BLOCKS {
            return self.refuse(key, target, Reason::ClassStale, class);
        }
        // 4. re-validated now, against the last recorded class (D-17)
        if cached.class > p.max_risk_class {
            return self.refuse(key, target, Reason::RiskClassNotAllowed, class);
        }
        // 5. per transaction
        if amount > p.max_per_tx.0 {
            return self.refuse(key, target, Reason::MaxPerTxExceeded, class);
        }
        // 6. balance
        if amount > self.available() {
            return self.refuse(key, target, Reason::InsufficientBalance, class);
        }
        // 7. reservation accounting
        let today = Self::today();
        let mut budget = agent.budget.clone();
        if budget.day_index != today {
            budget.spent_today = U128(0);
            budget.day_index = today;
        }
        if budget.spent_today.0 + budget.reserved.0 + amount > p.daily_cap.0 {
            return self.refuse(key, target, Reason::DailyCapExceeded, class);
        }
        // 8. the adapter's own check: slippage against a 1:1 NEAR swap
        let floor = amount - amount * p.max_slippage_bps as u128 / 10_000;
        if min_amount_out < floor {
            return self.refuse(key, target, Reason::SlippageTooHigh, class);
        }
        budget.reserved = U128(budget.reserved.0 + amount);
        self.agent_mut(key).budget = budget;
        self.reserved_total += amount;
        SpendOutcome::Allowed { amount: U128(amount), class: cached.class }
    }
}

#[near]
impl Vault {
    /// Called by an agent key. Returns `SpendOutcome` as JSON when refused; when allowed, the result
    /// is the settlement's, from `cb_settle`.
    pub fn spend(&mut self, adapter: String, target: AccountId, amount: U128, min_amount_out: U128) {
        require!(env::predecessor_account_id() == env::current_account_id(), panics::UNKNOWN_AGENT);
        let key = env::signer_account_pk();
        let outcome = self.check_and_reserve(&key, &adapter, &target, amount.0, min_amount_out.0);
        let SpendOutcome::Allowed { class, .. } = outcome else {
            env::value_return(serde_json::to_vec(&outcome).unwrap());
            return;
        };
        emit("execution_allowed", json!({ "agent": key, "adapter": adapter, "target": target, "amount": amount, "class": class }));
        let args = json!({ "min_amount_out": min_amount_out }).to_string();
        let p = env::promise_create(target.clone(), "swap", args, NearToken::from_yoctonear(amount.0), GAS_SWAP);
        let cb_args = json!({ "agent": key, "target": target, "amount": amount, "class": class }).to_string();
        let cb = env::promise_then(p, env::current_account_id(), "cb_settle", cb_args, NearToken::from_yoctonear(0), GAS_CB_SETTLE);
        env::promise_return(cb);
    }

    /// Settles a reservation. Success: spent and exposure recorded. Failure: the reservation is released
    /// and nothing else changes (the attached amount is refunded to the vault by the protocol).
    pub fn cb_settle(&mut self, agent: PublicKey, target: AccountId, amount: U128, class: RiskClass) -> bool {
        assert_self();
        // Only an explicit failure counts as failed. A result too long to read still means the swap ran;
        // this callback must never panic, or the reservation would never be released.
        let ok = !matches!(env::promise_result_checked(0, 64), Err(PromiseError::Failed));
        self.reserved_total -= amount.0;
        let a = self.agent_mut(&agent);
        a.budget.reserved = U128(a.budget.reserved.0 - amount.0);
        if !ok {
            emit("execution_failed", json!({ "agent": agent, "target": target, "amount": amount }));
            return false;
        }
        a.budget.spent_today = U128(a.budget.spent_today.0 + amount.0);
        let now = env::block_height();
        let mut e = self.exposure.get(&target).cloned().unwrap_or(Exposure { amount: U128(0), class_at_record: class, first_seen: now, last_updated: now });
        e.amount = U128(e.amount.0 + amount.0);
        e.class_at_record = class;
        e.last_updated = now;
        emit("exposure_recorded", json!({ "agent": agent, "target": target, "amount": amount, "class": class, "total": e.amount }));
        self.exposure.insert(target, e);
        true
    }
}
