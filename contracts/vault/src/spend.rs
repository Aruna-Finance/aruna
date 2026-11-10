//! The spend flow (docs/CONTRACTS.md "The `spend` flow"), in its documented order.
//!
//! Policy refusals RETURN `Blocked { reason }` and persist their event and counter; authorization
//! failures panic (CLAUDE.md rule 9). The daily cap uses reservation accounting, checked and reserved
//! in the same receipt, so parallel requests cannot jointly pass it (docs/DECISIONS.md D-16).
//!
//! Two adapters, each a named action, never a generic executor (CLAUDE.md rule 5):
//! - `swap` (NEAR): calls `swap(min_amount_out)` on the target with the amount attached.
//! - `ft_swap` (a token in the ceiling): `ft_transfer_call` on the token to the target, with
//!   `{"min_amount_out"}` as the message.
//! In both the target pays its output back to its caller, the vault. No adapter has an argument that
//! names a receiver. Limits, budgets and exposure are per token (plan R4).

use crate::agents::limits_for;
use crate::class_cache::assert_self;
use crate::tokens::GAS_FT_TRANSFER_CALL;
use crate::{AgentStatus, Budget, Vault, VaultExt};
use aruna_common::reasons::panics;
use aruna_common::{emit, Reason, RiskClass, TokenId, AUTO_DISABLE_THRESHOLD, AUTO_DISABLE_WINDOW_BLOCKS, DAY_NS, MAX_CLASS_AGE_BLOCKS};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PromiseError, PublicKey};

const GAS_SWAP: Gas = Gas::from_tgas(20);
const GAS_CB_SETTLE: Gas = Gas::from_tgas(15);
pub const ADAPTERS: &[&str] = &["swap", "ft_swap"];

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

    /// NEAR a new spend may use: total minus storage staking minus everything in flight. Tokens have
    /// no such check: the token contract refuses a transfer the vault cannot cover (see tokens.rs).
    fn available_near(&self) -> u128 {
        let storage = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128;
        env::account_balance().as_yoctonear().saturating_sub(storage).saturating_sub(self.reserved_of(&TokenId::Near))
    }

    fn reserved_of(&self, token: &TokenId) -> u128 {
        self.reserved.get(token).copied().unwrap_or(0)
    }

    fn add_reserved(&mut self, token: &TokenId, delta: i128) {
        let next = (self.reserved_of(token) as i128 + delta) as u128;
        self.reserved.insert(token.clone(), next);
    }

    /// The agent's budget in `token`, rolled to today.
    fn budget_of(budgets: &[Budget], token: &TokenId) -> Budget {
        let today = Self::today();
        let mut b = budgets.iter().find(|b| &b.token == token).cloned().unwrap_or(Budget { token: token.clone(), spent_today: U128(0), reserved: U128(0), day_index: today });
        if b.day_index != today {
            b.spent_today = U128(0);
            b.day_index = today;
        }
        b
    }

    fn put_budget(budgets: &mut Vec<Budget>, b: Budget) {
        match budgets.iter_mut().find(|x| x.token == b.token) {
            Some(x) => *x = b,
            None => budgets.push(b),
        }
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

    /// Steps 0–8, read-only: the one implementation of the spend checks, shared by `spend` and
    /// `simulate` so the two can never disagree. Authorization failures still panic.
    fn evaluate(&self, key: &PublicKey, adapter: &str, token: &TokenId, target: &AccountId, amount: u128, min_amount_out: u128) -> Result<RiskClass, (Reason, Option<RiskClass>)> {
        // 0. a registered key, and the agent may act
        let agent = self.agents.get(key).unwrap_or_else(|| env::panic_str(panics::UNKNOWN_AGENT));
        require!(ADAPTERS.contains(&adapter), "ARUNA_UNKNOWN_ADAPTER");
        let cached = self.classes.get(target);
        let class = cached.map(|c| c.class);
        match agent.status {
            AgentStatus::Active => {}
            _ if agent.auto_disabled => return Err((Reason::AgentAutoDisabled, class)),
            _ => return Err((Reason::AgentNotActive, class)),
        }
        let p = &agent.policy;
        // 1. target in policy
        if !p.allowed_targets.contains(target) {
            return Err((Reason::TargetNotAllowed, class));
        }
        // 2–3. a recorded class, not frozen, fetched recently enough
        let Some(cached) = cached else {
            return Err((Reason::ClassStale, None));
        };
        if cached.frozen {
            return Err((Reason::TargetFrozen, class));
        }
        if env::block_height().saturating_sub(cached.fetched_at_block) > MAX_CLASS_AGE_BLOCKS {
            return Err((Reason::ClassStale, class));
        }
        // 4. re-validated now, against the last recorded class (D-17)
        if cached.class > p.max_risk_class {
            return Err((Reason::RiskClassNotAllowed, class));
        }
        // 5. per transaction, in this token (a token missing from the policy has limits of zero)
        let (max_per_tx, daily_cap) = limits_for(p, token);
        if amount > max_per_tx {
            return Err((Reason::MaxPerTxExceeded, class));
        }
        // 6. balance (NEAR only; see available_near)
        if *token == TokenId::Near && amount > self.available_near() {
            return Err((Reason::InsufficientBalance, class));
        }
        // 7. reservation accounting, per token
        let budget = Self::budget_of(&agent.budgets, token);
        if budget.spent_today.0 + budget.reserved.0 + amount > daily_cap {
            return Err((Reason::DailyCapExceeded, class));
        }
        // 8. the adapter's own check: slippage against a 1:1 swap
        let floor = amount - amount * p.max_slippage_bps as u128 / 10_000;
        if min_amount_out < floor {
            return Err((Reason::SlippageTooHigh, class));
        }
        Ok(cached.class)
    }

    /// `evaluate`, then on a refusal record it (event, counter); on success reserve the amount.
    fn check_and_reserve(&mut self, key: &PublicKey, adapter: &str, token: &TokenId, target: &AccountId, amount: u128, min_amount_out: u128) -> SpendOutcome {
        match self.evaluate(key, adapter, token, target, amount, min_amount_out) {
            Err((reason, class)) => self.refuse(key, target, reason, class),
            Ok(class) => {
                let agent = self.agents.get(key).unwrap();
                let mut budget = Self::budget_of(&agent.budgets, token);
                budget.reserved = U128(budget.reserved.0 + amount);
                Self::put_budget(&mut self.agent_mut(key).budgets, budget);
                self.add_reserved(token, amount as i128);
                SpendOutcome::Allowed { amount: U128(amount), class }
            }
        }
    }

    fn resolve_token(adapter: &str, token: Option<AccountId>) -> TokenId {
        match (adapter, token) {
            ("swap", None) => TokenId::Near,
            ("ft_swap", Some(t)) => TokenId::Ft(t),
            ("swap", Some(_)) | ("ft_swap", None) => env::panic_str("ARUNA_ADAPTER_TOKEN_MISMATCH"),
            _ => env::panic_str("ARUNA_UNKNOWN_ADAPTER"),
        }
    }
}

/// What `simulate` returns. Not binding: state can change before a spend lands (docs/MCP.md).
#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Simulation {
    /// "allow" or "block". There is no third verdict: no approval queues.
    pub verdict: String,
    pub reason: Option<Reason>,
    /// The target's class as this vault last recorded it, if any.
    pub class: Option<RiskClass>,
}

#[near]
impl Vault {
    /// Called by an agent key. Returns `SpendOutcome` as JSON when refused; when allowed, the result
    /// is the settlement's, from `cb_settle`.
    /// `token` is the token contract for `ft_swap` and must be omitted for `swap`.
    pub fn spend(&mut self, adapter: String, target: AccountId, amount: U128, min_amount_out: U128, token: Option<AccountId>) {
        require!(env::predecessor_account_id() == env::current_account_id(), panics::UNKNOWN_AGENT);
        let key = env::signer_account_pk();
        let token = Self::resolve_token(&adapter, token);
        require!(self.accepts_token(&token), "ARUNA_TOKEN_NOT_IN_CEILING");
        let outcome = self.check_and_reserve(&key, &adapter, &token, &target, amount.0, min_amount_out.0);
        let SpendOutcome::Allowed { class, .. } = outcome else {
            env::value_return(serde_json::to_vec(&outcome).unwrap());
            return;
        };
        emit("execution_allowed", json!({ "agent": key, "adapter": adapter, "target": target, "amount": amount, "class": class, "token": token }));
        let p = match &token {
            TokenId::Near => {
                let args = json!({ "min_amount_out": min_amount_out }).to_string();
                env::promise_create(target.clone(), "swap", args, NearToken::from_yoctonear(amount.0), GAS_SWAP)
            }
            TokenId::Ft(contract) => {
                let msg = json!({ "min_amount_out": min_amount_out }).to_string();
                let args = json!({ "receiver_id": target, "amount": amount, "msg": msg }).to_string();
                env::promise_create(contract.clone(), "ft_transfer_call", args, NearToken::from_yoctonear(1), GAS_FT_TRANSFER_CALL)
            }
        };
        let cb_args = json!({ "agent": key, "target": target, "amount": amount, "class": class, "token": token }).to_string();
        let cb = env::promise_then(p, env::current_account_id(), "cb_settle", cb_args, NearToken::from_yoctonear(0), GAS_CB_SETTLE);
        env::promise_return(cb);
    }

    /// A free view running exactly the checks `spend` runs, for one agent key, without reserving,
    /// counting or sending anything. NOT BINDING: state can change before the spend lands.
    pub fn simulate(&self, public_key: PublicKey, adapter: String, target: AccountId, amount: U128, min_amount_out: U128, token: Option<AccountId>) -> Simulation {
        let token = Self::resolve_token(&adapter, token);
        require!(self.accepts_token(&token), "ARUNA_TOKEN_NOT_IN_CEILING");
        match self.evaluate(&public_key, &adapter, &token, &target, amount.0, min_amount_out.0) {
            Ok(class) => Simulation { verdict: "allow".into(), reason: None, class: Some(class) },
            Err((reason, class)) => Simulation { verdict: "block".into(), reason: Some(reason), class },
        }
    }

    /// Settles a reservation. Success: what was used is spent and recorded as exposure. Failure: the
    /// reservation is released and nothing else changes (a failed call refunds the vault by protocol).
    /// For NEAR the whole amount is used when the call succeeded. For a token, `ft_transfer_call`
    /// returns the amount used; zero means the target took nothing.
    pub fn cb_settle(&mut self, agent: PublicKey, target: AccountId, amount: U128, class: RiskClass, token: Option<TokenId>) -> bool {
        assert_self();
        let token = token.unwrap_or(TokenId::Near);
        // Only an explicit failure counts as failed. A result too long to read still means the call ran;
        // this callback must never panic, or the reservation would never be released.
        let result = env::promise_result_checked(0, 64);
        let used = match (&token, result) {
            (_, Err(PromiseError::Failed)) => 0,
            (TokenId::Near, _) => amount.0,
            (TokenId::Ft(_), Ok(bytes)) => serde_json::from_slice::<U128>(&bytes).map(|u| u.0.min(amount.0)).unwrap_or(0),
            (TokenId::Ft(_), Err(_)) => 0,
        };
        self.add_reserved(&token, -(amount.0 as i128));
        let a = self.agent_mut(&agent);
        let mut b = Self::budget_of(&a.budgets, &token);
        // Settled after midnight: budget_of has already rolled it to the day it settles in.
        b.reserved = U128(b.reserved.0.saturating_sub(amount.0));
        if used == 0 {
            Self::put_budget(&mut a.budgets, b);
            emit("execution_failed", json!({ "agent": agent, "target": target, "amount": amount, "token": token }));
            return false;
        }
        b.spent_today = U128(b.spent_today.0 + used);
        Self::put_budget(&mut a.budgets, b);
        let total = self.record_exposure(&agent, &target, &token, used, class);
        emit("exposure_recorded", json!({ "agent": agent, "target": target, "amount": U128(used), "class": class, "token": token, "total": U128(total) }));
        true
    }
}
