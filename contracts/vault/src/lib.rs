//! vault — one per client (docs/CONTRACTS.md).
//!
//! Deployed by the factory from one global contract by hash, with no full-access key. Authority
//! lives in state: the client is the owner, the agent-as-a-service company is the operator. Agents
//! are function-call keys this contract adds and deletes on its own account.
//!
//! Hard rules (CLAUDE.md 9 and 11): authorization failures panic, policy refusals return; and this
//! code never uses near-sdk's `Promise`, only `env::promise_batch_*`, so the compiled module imports
//! none of the host functions the classifier scans.

mod agents;
mod roles;

use aruna_common::RiskClass;
use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{near, AccountId, BorshStorageKey, PanicOnDefault, PublicKey};

/// The only methods an agent key may call. Never a `cb_` method: a key on the vault passes the
/// usual `predecessor == current_account_id` guard, so `method_names` is what keeps an agent out of
/// callbacks (docs/DECISIONS.md D-03).
pub const AGENT_METHODS: &[&str] = &["spend", "refresh_class"];

/// The client's limits. Only the owner sets them; every agent policy must fit inside.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Ceiling {
    pub max_per_tx: U128,
    /// Covers the sum of all agents' daily caps, or an operator could reach any total by adding keys.
    pub daily_total: U128,
    pub max_risk_class: RiskClass,
    pub allowed_targets: Vec<AccountId>,
    /// Gas allowance given to each agent key, in yoctoNEAR. Must exceed one call's prepaid gas
    /// (docs/NEAR-FACTS.md §10, T6).
    pub agent_allowance: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub max_per_tx: U128,
    pub daily_cap: U128,
    pub max_slippage_bps: u16,
    pub allowed_targets: Vec<AccountId>,
    pub max_risk_class: RiskClass,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AgentStatus {
    Active,
    Paused,
    Revoked,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Agent {
    pub label: String,
    pub status: AgentStatus,
    pub policy: Policy,
    pub created_at: u64,
}

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Agents,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    operator: Option<AccountId>,
    registry: AccountId,
    ceiling: Ceiling,
    agents: IterableMap<PublicKey, Agent>,
}

#[near(serializers = [json])]
pub struct VaultConfig {
    pub owner: AccountId,
    pub operator: Option<AccountId>,
    pub registry: AccountId,
    pub ceiling: Ceiling,
    pub agent_methods: Vec<String>,
}

#[near]
impl Vault {
    /// Called once by the factory in the same batch that creates the account.
    #[init]
    pub fn new(owner: AccountId, operator: Option<AccountId>, registry: AccountId, ceiling: Ceiling) -> Self {
        Self { owner, operator, registry, ceiling, agents: IterableMap::new(Key::Agents) }
    }

    pub fn get_config(&self) -> VaultConfig {
        VaultConfig {
            owner: self.owner.clone(),
            operator: self.operator.clone(),
            registry: self.registry.clone(),
            ceiling: self.ceiling.clone(),
            agent_methods: AGENT_METHODS.iter().map(|m| m.to_string()).collect(),
        }
    }

    pub fn get_agent(&self, public_key: PublicKey) -> Option<Agent> {
        self.agents.get(&public_key).cloned()
    }

    pub fn get_agents(&self) -> Vec<(PublicKey, Agent)> {
        self.agents.iter().map(|(k, a)| (k.clone(), a.clone())).collect()
    }
}

#[cfg(test)]
mod tests;
