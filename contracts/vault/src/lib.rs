//! vault — one per client (docs/CONTRACTS.md).
//!
//! Deployed by the factory from one global contract by hash, with no full-access key. Authority
//! lives in state: the client is the owner, the agent-as-a-service company is the operator. Agents
//! are function-call keys this contract adds and deletes on its own account.
//!
//! Hard rules (CLAUDE.md 9 and 11): authorization failures panic, policy refusals return; and this
//! code never uses near-sdk's `Promise`, only `env::promise_batch_*`, so the compiled module imports
//! none of the host functions the classifier scans.

pub(crate) mod agents;
mod class_cache;
mod exposure;
mod roles;
mod spend;
mod tokens;

pub use spend::SpendOutcome;

use aruna_common::{RiskClass, TokenId};
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{near, AccountId, BorshStorageKey, PanicOnDefault, PublicKey};

/// The only methods an agent key may call. Never a `cb_` method: a key on the vault passes the
/// usual `predecessor == current_account_id` guard, so `method_names` is what keeps an agent out of
/// callbacks (docs/DECISIONS.md D-03).
pub const AGENT_METHODS: &[&str] = &["spend", "refresh_class"];

/// The owner's limits for one token. Amounts are in that token's smallest unit.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenCeiling {
    pub token: TokenId,
    pub max_per_tx: U128,
    /// Covers the sum of all agents' daily caps in this token, or an operator could reach any total by
    /// adding keys.
    pub daily_total: U128,
}

/// The client's limits. Only the owner sets them; every agent policy must fit inside. A token not
/// listed is a token this vault does not accept or spend: there is no conversion between tokens.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Ceiling {
    pub tokens: Vec<TokenCeiling>,
    pub max_risk_class: RiskClass,
    pub allowed_targets: Vec<AccountId>,
    /// Gas allowance given to each agent key, in yoctoNEAR. Must exceed one call's prepaid gas
    /// (docs/NEAR-FACTS.md §10, T6).
    pub agent_allowance: U128,
}

/// One agent's limits in one token. A token missing from a policy has limits of zero.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenLimits {
    pub token: TokenId,
    pub max_per_tx: U128,
    pub daily_cap: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub limits: Vec<TokenLimits>,
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
    /// Set when the vault paused the agent itself; only the owner can resume it.
    pub auto_disabled: bool,
    /// Per-token daily accounting.
    pub budgets: Vec<Budget>,
    /// (block, weight) of agent-caused refusals inside the rolling window.
    pub refusals: Vec<(u64, u32)>,
    /// Bumped on every policy change. Coverage records the version it was priced on (plan R10).
    pub policy_version: u32,
    /// Last block at which the policy was loosened; 0 if never. A claim on coverage bought before it
    /// is rejected (plan R10).
    pub last_loosened_at: u64,
}

/// Per-agent daily accounting in one token. `reserved` is in flight: sent but not yet settled.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Budget {
    pub token: TokenId,
    pub spent_today: U128,
    pub reserved: U128,
    pub day_index: u64,
}

/// The vault's last recorded view of a target's class. Never a live read: no contract can read
/// another account's state (docs/NEAR-FACTS.md §1).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct CachedClass {
    pub class: RiskClass,
    pub frozen: bool,
    /// When the registry recorded it, shown to users.
    pub classified_at_block: u64,
    /// When this vault fetched it; MAX_CLASS_AGE_BLOCKS applies to this.
    pub fetched_at_block: u64,
}

/// What passed through the vault to a target: what was SENT, not the position's value.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Exposure {
    pub amount: U128,
    pub class_at_record: RiskClass,
    pub first_seen: u64,
    pub last_updated: u64,
}

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Agents,
    Classes,
    Exposure,
    Checkpoints,
    Reserved,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    operator: Option<AccountId>,
    registry: AccountId,
    ceiling: Ceiling,
    agents: IterableMap<PublicKey, Agent>,
    classes: LookupMap<AccountId, CachedClass>,
    /// Running total per (target, token).
    exposure: LookupMap<(AccountId, TokenId), Exposure>,
    /// Exposure history per (agent, target, token): (block, cumulative amount) at each settlement,
    /// so the pool can ask what was recorded before a block (plan R22).
    checkpoints: LookupMap<(PublicKey, AccountId, TokenId), Vec<(u64, u128)>>,
    /// Sum of every agent's reservation per token, kept out of the balance available to new spends.
    reserved: LookupMap<TokenId, u128>,
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
        Self {
            owner,
            operator,
            registry,
            ceiling,
            agents: IterableMap::new(Key::Agents),
            classes: LookupMap::new(Key::Classes),
            exposure: LookupMap::new(Key::Exposure),
            checkpoints: LookupMap::new(Key::Checkpoints),
            reserved: LookupMap::new(Key::Reserved),
        }
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

    pub fn get_class(&self, target: AccountId) -> Option<CachedClass> {
        self.classes.get(&target).cloned()
    }

    /// Running exposure to a target in one token (NEAR when `token` is omitted).
    pub fn get_exposure(&self, target: AccountId, token: Option<TokenId>) -> Option<Exposure> {
        self.exposure.get(&(target, token.unwrap_or(TokenId::Near))).cloned()
    }
}

#[cfg(test)]
mod tests;
