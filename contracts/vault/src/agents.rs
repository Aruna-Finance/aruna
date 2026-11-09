//! Agents are function-call keys on this account, managed by the contract itself with low-level
//! promises (docs/NEAR-FACTS.md §10, T7). Owner and operator can add, pause, revoke and tighten; only
//! the owner can loosen a policy or resume an agent.

use crate::{Agent, AgentStatus, Policy, Vault, VaultExt, AGENT_METHODS};
use aruna_common::emit;
use aruna_common::reasons::panics;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, Allowance, PublicKey};

/// True if `next` permits anything `prev` did not.
pub(crate) fn loosens(prev: &Policy, next: &Policy) -> bool {
    next.max_per_tx.0 > prev.max_per_tx.0
        || next.daily_cap.0 > prev.daily_cap.0
        || next.max_slippage_bps > prev.max_slippage_bps
        || next.max_risk_class > prev.max_risk_class
        || next.allowed_targets.iter().any(|t| !prev.allowed_targets.contains(t))
}

impl Vault {
    /// The policy must fit the owner's ceiling, including the sum of daily caps across agents that
    /// can still spend. `replacing` is the key whose current cap is being replaced, if any.
    fn assert_within_ceiling(&self, policy: &Policy, replacing: Option<&PublicKey>) {
        let c = &self.ceiling;
        require!(policy.max_per_tx.0 <= c.max_per_tx.0, panics::OVER_CEILING);
        require!(policy.max_risk_class <= c.max_risk_class, panics::OVER_CEILING);
        require!(policy.allowed_targets.iter().all(|t| c.allowed_targets.contains(t)), panics::OVER_CEILING);
        let others: u128 = self
            .agents
            .iter()
            .filter(|(k, a)| a.status != AgentStatus::Revoked && Some(*k) != replacing)
            .map(|(_, a)| a.policy.daily_cap.0)
            .sum();
        require!(others + policy.daily_cap.0 <= c.daily_total.0, panics::OVER_CEILING);
    }

    pub(crate) fn agent_mut(&mut self, key: &PublicKey) -> &mut Agent {
        self.agents.get_mut(key).unwrap_or_else(|| env::panic_str(panics::UNKNOWN_AGENT))
    }

    fn set_status(&mut self, key: &PublicKey, status: AgentStatus) {
        let agent = self.agent_mut(key);
        require!(agent.status != AgentStatus::Revoked, panics::REVOKED);
        let before = agent.status;
        agent.status = status;
        if status == AgentStatus::Active {
            agent.auto_disabled = false;
            agent.refusals.clear();
        }
        emit("agent_status_changed", json!({ "public_key": key, "before": before, "after": status }));
    }
}

#[near]
impl Vault {
    /// Owner or operator. Adds the key to this account, restricted to AGENT_METHODS on this account.
    pub fn add_agent(&mut self, public_key: PublicKey, label: String, policy: Policy) {
        self.assert_owner_or_operator();
        require!(!self.agents.contains_key(&public_key), panics::AGENT_EXISTS);
        self.assert_within_ceiling(&policy, None);

        let methods = AGENT_METHODS.join(",");
        require!(!AGENT_METHODS.iter().any(|m| m.starts_with("cb_")), panics::BAD_METHOD_NAME);
        let me = env::current_account_id();
        let allowance = Allowance::Limited(self.ceiling.agent_allowance.0.try_into().expect("agent_allowance must be non-zero"));
        let p = env::promise_batch_create(&me);
        env::promise_batch_action_add_key_allowance_with_function_call(p, &public_key, 0, allowance, &me, &methods);

        emit(
            "agent_registered",
            json!({ "public_key": public_key, "label": label, "policy": policy, "by": env::predecessor_account_id(), "methods": methods }),
        );
        let agent = Agent {
            label,
            status: AgentStatus::Active,
            policy,
            created_at: env::block_height(),
            auto_disabled: false,
            budget: Default::default(),
            refusals: vec![],
        };
        self.agents.insert(public_key, agent);
    }

    /// Owner or operator. The key stays; `spend` refuses with ARUNA_AGENT_NOT_ACTIVE.
    pub fn pause_agent(&mut self, public_key: PublicKey) {
        self.assert_owner_or_operator();
        self.set_status(&public_key, AgentStatus::Paused);
    }

    /// Owner only: the operator cannot undo a pause, including an auto-disable.
    pub fn resume_agent(&mut self, public_key: PublicKey) {
        require!(self.is_owner(), if self.is_operator() { panics::OPERATOR_CANNOT_RESUME } else { panics::NOT_OWNER });
        self.set_status(&public_key, AgentStatus::Active);
    }

    /// Owner or operator. Deletes the key, so the network itself rejects the agent from then on.
    pub fn revoke_agent(&mut self, public_key: PublicKey) {
        self.assert_owner_or_operator();
        self.set_status(&public_key, AgentStatus::Revoked);
        let p = env::promise_batch_create(&env::current_account_id());
        env::promise_batch_action_delete_key(p, &public_key);
    }

    /// Owner: any policy inside the ceiling. Operator: only one that permits nothing new.
    pub fn update_policy(&mut self, public_key: PublicKey, policy: Policy) {
        self.assert_owner_or_operator();
        let prev = self.agents.get(&public_key).unwrap_or_else(|| env::panic_str(panics::UNKNOWN_AGENT)).policy.clone();
        if !self.is_owner() {
            require!(!loosens(&prev, &policy), panics::OPERATOR_CANNOT_LOOSEN);
        }
        self.assert_within_ceiling(&policy, Some(&public_key));
        emit("policy_updated", json!({ "public_key": public_key, "before": prev, "after": policy, "by": env::predecessor_account_id() }));
        self.agent_mut(&public_key).policy = policy;
    }
}
