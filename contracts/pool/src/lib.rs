//! pool — shared: underwriter capital, coverage and payouts (docs/CONTRACTS.md "pool", plan U5).
//! TESTNET ONLY until release gate B. Every economic parameter is a declared assumption
//! (aruna_common::params). One book per token: coverage, premium, capital and payout are always in the
//! same token, with no conversion (plan R1, R2).
//!
//! The pool reads the vault and the registry itself and never trusts the caller (plan KTD10): at
//! purchase the vault's record, the target's class and its attestor's heartbeat from the registry, and
//! the agent's policy from the vault; at claim the report's state, and exposure-before and policy
//! history from the vault, accepted only from a vault on an allowed code hash.

mod pricing;
mod views;

pub use pricing::{Assumptions, Quote};

use aruna_common::params::{CLAIM_REPORTING_BLOCKS, CONCENTRATION_BPS, K_X100, WAITING_PERIOD_BLOCKS};
use aruna_common::{emit, ReportState, RiskClass, TokenId};
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, PublicKey};

const GAS_VIEW: Gas = Gas::from_tgas(5);
const GAS_CB_BUY: Gas = Gas::from_tgas(30);
const GAS_CB_CLAIM: Gas = Gas::from_tgas(40);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Book {
    /// Underwriter deposits, premiums and slashed bonds, less payouts and withdrawals.
    pub capital: U128,
    pub total_shares: U128,
    /// Sum of the remaining limits of coverage not yet past its reporting period.
    pub total_limits: U128,
    /// No withdrawal before this block: the latest coverage end plus its reporting period (plan R24).
    pub locked_until: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ClaimRecord {
    pub report_id: u32,
    pub paid: U128,
    /// "paid", or why the claim was rejected.
    pub outcome: String,
    pub block: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Coverage {
    pub id: u32,
    /// Payouts go here: the vault's owner at purchase.
    pub owner: AccountId,
    pub vault: AccountId,
    pub agent: PublicKey,
    pub target: AccountId,
    pub token: TokenId,
    /// Sum insured `C`.
    pub limit: U128,
    pub payout_ratio_bps: u16,
    pub premium_paid: U128,
    pub class: RiskClass,
    pub code_hash: String,
    pub upgrade_authority: AccountId,
    pub start_block: u64,
    pub waiting_period_ends: u64,
    pub end_block: u64,
    /// The policy it was priced on (plan R10).
    pub policy_version: u32,
    pub daily_cap_priced: U128,
    pub paid_out: U128,
    pub claims: Vec<ClaimRecord>,
    pub claim_in_flight: bool,
    /// Set once its remaining limit has left the book's totals (`release_expired`).
    #[serde(default)]
    pub released: bool,
}

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Books,
    Shares,
    Coverages,
    ByHash,
    ByAuthority,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Pool {
    owner: AccountId,
    registry: AccountId,
    books: LookupMap<TokenId, Book>,
    shares: LookupMap<(AccountId, TokenId), u128>,
    coverages: Vector<Coverage>,
    /// Remaining limits per (token, resolved code hash) and per (token, upgrade authority) (D-24).
    by_hash: LookupMap<(TokenId, String), u128>,
    by_authority: LookupMap<(TokenId, AccountId), u128>,
}

/// What the buyer asks for. Sent as call args (NEAR) or as the `ft_transfer_call` message (token).
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BuyRequest {
    pub vault: AccountId,
    pub agent: PublicKey,
    pub target: AccountId,
    pub limit: U128,
    pub payout_ratio_bps: u16,
    pub window_blocks: u64,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "action", rename_all = "snake_case")]
enum FtMsg {
    Deposit,
    Buy(BuyRequest),
}

// Read-only shapes of what the registry and the vault return; unknown fields are ignored.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct VaultRecordView {
    owner: AccountId,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ClassView {
    class: RiskClass,
    frozen: bool,
    resolved_code_hash: Option<String>,
    upgrade_authority: Option<AccountId>,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct LimitsView {
    token: TokenId,
    daily_cap: U128,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct PolicyView {
    limits: Vec<LimitsView>,
    allowed_targets: Vec<AccountId>,
    max_risk_class: RiskClass,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct AgentView {
    status: String,
    policy: PolicyView,
    policy_version: u32,
    last_loosened_at: u64,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ReportFields {
    target: AccountId,
    changed_at_block: u64,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ReportView {
    report: ReportFields,
    state: ReportState,
}

fn result<T: near_sdk::serde::de::DeserializeOwned>(i: u64) -> Option<T> {
    match env::promise_result_checked(i, 16_384) {
        Ok(bytes) => serde_json::from_slice(&bytes).ok(),
        Err(_) => None,
    }
}

/// `a * b / c` without overflow: share arithmetic multiplies two yoctoNEAR-sized numbers (1e25 × 1e25
/// exceeds u128). 256-bit product, then long division. Rounds down; panics if c is 0 or the result
/// does not fit in u128.
pub(crate) fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    require!(c != 0, "ARUNA_DIVIDE_BY_ZERO");
    let (a_hi, a_lo) = (a >> 64, a & u64::MAX as u128);
    let (b_hi, b_lo) = (b >> 64, b & u64::MAX as u128);
    let lo_lo = a_lo * b_lo;
    let mid1 = a_hi * b_lo;
    let mid2 = a_lo * b_hi;
    let hi_hi = a_hi * b_hi;
    let (mid, mid_carry) = mid1.overflowing_add(mid2);
    let (lo, lo_carry) = lo_lo.overflowing_add(mid << 64);
    let hi = hi_hi + (mid >> 64) + ((mid_carry as u128) << 64) + lo_carry as u128;
    // Divide the 256-bit (hi, lo) by c, bit by bit.
    let (mut q, mut r) = (0u128, 0u128);
    for i in (0..256).rev() {
        let bit = if i >= 128 { (hi >> (i - 128)) & 1 } else { (lo >> i) & 1 };
        let carry = r >> 127;
        r = (r << 1) | bit;
        if carry == 1 || r >= c {
            r = r.wrapping_sub(c);
            require!(i < 128, "ARUNA_MUL_DIV_OVERFLOW");
            q |= 1 << i;
        }
    }
    q
}

fn pay(token: &TokenId, to: &AccountId, amount: u128) {
    if amount == 0 {
        return;
    }
    match token {
        TokenId::Near => Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount)).detach(),
        TokenId::Ft(c) => Promise::new(c.clone())
            .function_call("ft_transfer".to_string(), json!({ "receiver_id": to, "amount": U128(amount) }).to_string().into_bytes(), NearToken::from_yoctonear(1), GAS_FT_TRANSFER)
            .detach(),
    }
}

impl Pool {
    fn book(&self, token: &TokenId) -> Book {
        self.books.get(token).cloned().unwrap_or_default()
    }

    fn add_capital(&mut self, token: &TokenId, amount: u128) {
        let mut b = self.book(token);
        b.capital = U128(b.capital.0 + amount);
        self.books.insert(token.clone(), b);
    }

    fn deposit_for(&mut self, who: &AccountId, token: &TokenId, amount: u128) {
        require!(amount > 0, "ARUNA_ZERO_DEPOSIT");
        let mut b = self.book(token);
        let minted = if b.total_shares.0 == 0 || b.capital.0 == 0 { amount } else { mul_div(amount, b.total_shares.0, b.capital.0) };
        b.capital = U128(b.capital.0 + amount);
        b.total_shares = U128(b.total_shares.0 + minted);
        self.books.insert(token.clone(), b);
        let key = (who.clone(), token.clone());
        let held = self.shares.get(&key).copied().unwrap_or(0);
        self.shares.insert(key, held + minted);
        emit("capital_deposited", json!({ "underwriter": who, "token": token, "amount": U128(amount), "shares": U128(minted) }));
    }

    /// Starts the purchase: four reads in parallel, then `cb_buy`.
    fn start_buy(&self, buyer: AccountId, token: TokenId, paid: u128, req: BuyRequest) -> Promise {
        let view = |acc: &AccountId, method: &str, args: serde_json::Value| Promise::new(acc.clone()).function_call(method.to_string(), args.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_VIEW);
        view(&self.registry, "get_allowed_vault", json!({ "vault": req.vault }))
            .and(view(&self.registry, "get_class", json!({ "target": req.target })))
            .and(view(&self.registry, "heartbeat_fresh", json!({ "target": req.target })))
            .and(view(&req.vault, "get_agent", json!({ "public_key": req.agent })))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CB_BUY)
                    .cb_buy(buyer, token, U128(paid), req),
            )
    }

    /// Refunds `paid` (NEAR) and returns the amount to hand back (token path), with the reason.
    fn refuse_buy(&self, buyer: &AccountId, token: &TokenId, paid: u128, reason: &str) -> U128 {
        emit("coverage_refused", json!({ "buyer": buyer, "token": token, "reason": reason }));
        if *token == TokenId::Near {
            pay(token, buyer, paid);
            return U128(0);
        }
        U128(paid)
    }
}

#[near]
impl Pool {
    #[init]
    pub fn new(owner: AccountId, registry: AccountId) -> Self {
        Self {
            owner,
            registry,
            books: LookupMap::new(Key::Books),
            shares: LookupMap::new(Key::Shares),
            coverages: Vector::new(Key::Coverages),
            by_hash: LookupMap::new(Key::ByHash),
            by_authority: LookupMap::new(Key::ByAuthority),
        }
    }

    // ---- underwriters ----

    /// NEAR capital. Token capital arrives through `ft_transfer_call` with `{"action":"deposit"}`.
    #[payable]
    pub fn deposit(&mut self) {
        let who = env::predecessor_account_id();
        self.deposit_for(&who, &TokenId::Near, env::attached_deposit().as_yoctonear());
    }

    /// Burns shares for their pro-rata part of the book's capital. Refused while capital is locked.
    #[payable]
    pub fn withdraw(&mut self, token: TokenId, shares: U128) {
        near_sdk::assert_one_yocto();
        let who = env::predecessor_account_id();
        let mut b = self.book(&token);
        require!(env::block_height() >= b.locked_until, "ARUNA_CAPITAL_LOCKED");
        let key = (who.clone(), token.clone());
        let held = self.shares.get(&key).copied().unwrap_or(0);
        require!(shares.0 > 0 && shares.0 <= held, "ARUNA_NOT_ENOUGH_SHARES");
        let amount = mul_div(shares.0, b.capital.0, b.total_shares.0);
        b.capital = U128(b.capital.0 - amount);
        b.total_shares = U128(b.total_shares.0 - shares.0);
        self.books.insert(token.clone(), b);
        self.shares.insert(key, held - shares.0);
        emit("capital_withdrawn", json!({ "underwriter": who, "token": token, "amount": U128(amount) }));
        pay(&token, &who, amount);
    }

    /// The registry sends a slashed attestor bond here; it becomes NEAR capital (plan KTD9).
    #[payable]
    pub fn receive_slash(&mut self, attestor: AccountId) {
        require!(env::predecessor_account_id() == self.registry, "ARUNA_NOT_REGISTRY");
        let amount = env::attached_deposit().as_yoctonear();
        self.add_capital(&TokenId::Near, amount);
        emit("slash_received", json!({ "attestor": attestor, "amount": U128(amount) }));
    }

    // ---- buying ----

    /// NEAR coverage. Attach at least the quoted premium; the excess, or everything on a refusal, is
    /// returned. Only the vault's registered owner can buy.
    #[payable]
    pub fn buy_coverage(&mut self, request: BuyRequest) -> Promise {
        self.start_buy(env::predecessor_account_id(), TokenId::Near, env::attached_deposit().as_yoctonear(), request)
    }

    /// NEP-141 receiver: `{"action":"deposit"}` adds capital; `{"action":"buy", ...BuyRequest}` buys
    /// coverage in this token, paying the premium from the transferred amount.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = TokenId::Ft(env::predecessor_account_id());
        match serde_json::from_str::<FtMsg>(&msg) {
            Ok(FtMsg::Deposit) => {
                self.deposit_for(&sender_id, &token, amount.0);
                PromiseOrValue::Value(U128(0))
            }
            Ok(FtMsg::Buy(req)) => PromiseOrValue::Promise(self.start_buy(sender_id, token, amount.0, req)),
            Err(_) => PromiseOrValue::Value(amount),
        }
    }

    /// Finishes a purchase. Returns the token amount to hand back (always 0 for NEAR, refunded here).
    #[private]
    pub fn cb_buy(&mut self, buyer: AccountId, token: TokenId, paid: U128, request: BuyRequest) -> U128 {
        let paid = paid.0;
        let Some(Some(vault)) = result::<Option<VaultRecordView>>(0) else {
            return self.refuse_buy(&buyer, &token, paid, "vault not registered on an allowed code hash");
        };
        if vault.owner != buyer {
            return self.refuse_buy(&buyer, &token, paid, "only the vault's owner buys coverage");
        }
        let Some(Some(class)) = result::<Option<ClassView>>(1) else {
            return self.refuse_buy(&buyer, &token, paid, "target has no class record");
        };
        let (Some(code_hash), Some(authority)) = (class.resolved_code_hash, class.upgrade_authority) else {
            return self.refuse_buy(&buyer, &token, paid, "class record lacks code hash or upgrade authority");
        };
        if class.frozen {
            return self.refuse_buy(&buyer, &token, paid, "target is frozen");
        }
        if result::<bool>(2) != Some(true) {
            return self.refuse_buy(&buyer, &token, paid, "assigned attestor heartbeat is stale");
        }
        let Some(Some(agent)) = result::<Option<AgentView>>(3) else {
            return self.refuse_buy(&buyer, &token, paid, "agent not found on the vault");
        };
        if agent.status == "Revoked" || !agent.policy.allowed_targets.contains(&request.target) {
            return self.refuse_buy(&buyer, &token, paid, "agent cannot reach this target");
        }
        if class.class > agent.policy.max_risk_class {
            return self.refuse_buy(&buyer, &token, paid, "target class is above the agent's max_risk_class");
        }
        let daily_cap = agent.policy.limits.iter().find(|l| l.token == token).map(|l| l.daily_cap.0).unwrap_or(0);
        require!(request.window_blocks > WAITING_PERIOD_BLOCKS, "ARUNA_WINDOW_TOO_SHORT");
        let Some(q) = pricing::quote(class.class, request.limit.0, request.payout_ratio_bps, request.window_blocks, daily_cap) else {
            return self.refuse_buy(&buyer, &token, paid, "class is not insurable");
        };
        if paid < q.premium.0 {
            return self.refuse_buy(&buyer, &token, paid, "premium attached is below the quote");
        }
        let limit = request.limit.0;
        let book = self.book(&token);
        let capital_after = book.capital.0 + q.premium.0;
        if (book.total_limits.0 + limit) * 100 > K_X100 * capital_after {
            return self.refuse_buy(&buyer, &token, paid, "capital adequacy: total limits would exceed k x capital");
        }
        let hk = (token.clone(), code_hash.clone());
        let ak = (token.clone(), authority.clone());
        let on_hash = self.by_hash.get(&hk).copied().unwrap_or(0);
        let on_auth = self.by_authority.get(&ak).copied().unwrap_or(0);
        let conc = CONCENTRATION_BPS * capital_after / 10_000;
        if on_hash + limit > conc || on_auth + limit > conc {
            return self.refuse_buy(&buyer, &token, paid, "concentration limit for this code hash or upgrade authority");
        }

        let now = env::block_height();
        let id = self.coverages.len();
        let c = Coverage {
            id,
            owner: buyer.clone(),
            vault: request.vault.clone(),
            agent: request.agent.clone(),
            target: request.target.clone(),
            token: token.clone(),
            limit: request.limit,
            payout_ratio_bps: request.payout_ratio_bps,
            premium_paid: q.premium,
            class: class.class,
            code_hash,
            upgrade_authority: authority,
            start_block: now,
            waiting_period_ends: now + WAITING_PERIOD_BLOCKS,
            end_block: now + request.window_blocks,
            policy_version: agent.policy_version,
            daily_cap_priced: U128(daily_cap),
            paid_out: U128(0),
            claims: vec![],
            claim_in_flight: false,
            released: false,
        };
        let mut b = book;
        b.capital = U128(capital_after);
        b.total_limits = U128(b.total_limits.0 + limit);
        b.locked_until = b.locked_until.max(c.end_block + CLAIM_REPORTING_BLOCKS);
        self.books.insert(token.clone(), b);
        self.by_hash.insert(hk, on_hash + limit);
        self.by_authority.insert(ak, on_auth + limit);
        emit("coverage_purchased", json!({ "coverage": c, "quote": q }));
        self.coverages.push(c);
        let excess = paid - q.premium.0;
        if token == TokenId::Near {
            pay(&token, &buyer, excess);
            return U128(0);
        }
        U128(excess)
    }

    /// Anyone may call. For each coverage past its end and its claim reporting period, with no claim in
    /// flight, its remaining limit leaves the book's total and the concentration totals, so expired
    /// coverage stops holding capacity. Returns how many were released.
    pub fn release_expired(&mut self, ids: Vec<u32>) -> u32 {
        let now = env::block_height();
        let mut n = 0;
        for id in ids {
            let Some(c) = self.coverages.get(id).cloned() else { continue };
            if c.released || c.claim_in_flight || now < c.end_block + CLAIM_REPORTING_BLOCKS {
                continue;
            }
            let remaining = c.limit.0.saturating_sub(c.paid_out.0);
            let mut b = self.book(&c.token);
            b.total_limits = U128(b.total_limits.0.saturating_sub(remaining));
            self.books.insert(c.token.clone(), b);
            let hk = (c.token.clone(), c.code_hash.clone());
            let ak = (c.token.clone(), c.upgrade_authority.clone());
            let h = self.by_hash.get(&hk).copied().unwrap_or(0);
            self.by_hash.insert(hk, h.saturating_sub(remaining));
            let a = self.by_authority.get(&ak).copied().unwrap_or(0);
            self.by_authority.insert(ak, a.saturating_sub(remaining));
            self.coverages.get_mut(id).unwrap().released = true;
            emit("coverage_released", json!({ "coverage": id, "remaining_limit": U128(remaining) }));
            n += 1;
        }
        n
    }

    // ---- claims ----

    /// Anyone may start a claim; the payout always goes to the coverage's owner. Re-validated now, not
    /// at report time (plan R23).
    pub fn claim(&mut self, coverage_id: u32, report_id: u32) -> Promise {
        let c = self.coverages.get_mut(coverage_id).unwrap_or_else(|| env::panic_str("ARUNA_UNKNOWN_COVERAGE"));
        require!(!c.claim_in_flight, "ARUNA_CLAIM_IN_FLIGHT");
        require!(!c.claims.iter().any(|k| k.report_id == report_id && k.outcome == "paid"), "ARUNA_ALREADY_PAID");
        c.claim_in_flight = true;
        let vault = c.vault.clone();
        let args = |v: serde_json::Value| v.to_string().into_bytes();
        Promise::new(self.registry.clone())
            .function_call("get_report".to_string(), args(json!({ "id": report_id })), NearToken::from_yoctonear(0), GAS_VIEW)
            .and(Promise::new(self.registry.clone()).function_call("get_allowed_vault".to_string(), args(json!({ "vault": vault })), NearToken::from_yoctonear(0), GAS_VIEW))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_CLAIM).cb_claim_report(coverage_id, report_id))
    }

    #[private]
    pub fn cb_claim_report(&mut self, coverage_id: u32, report_id: u32) -> PromiseOrValue<U128> {
        let c = self.coverages.get(coverage_id).cloned().unwrap();
        let reject = |me: &mut Self, why: &str| {
            me.finish_claim(coverage_id, report_id, 0, why);
            PromiseOrValue::Value(U128(0))
        };
        let Some(Some(r)) = result::<Option<ReportView>>(0) else { return reject(self, "unknown report") };
        if result::<Option<VaultRecordView>>(1).flatten().is_none() {
            return reject(self, "vault is not on an allowed code hash");
        }
        match r.state {
            ReportState::Verified => {}
            ReportState::Pending => return reject(self, "challenge window still open"),
            ReportState::Disputed => return reject(self, "report is disputed"),
            ReportState::Rejected => return reject(self, "report was rejected by the arbiter"),
        }
        if r.report.target != c.target {
            return reject(self, "report is for another target");
        }
        let at = r.report.changed_at_block;
        if at < c.waiting_period_ends {
            return reject(self, "change inside the waiting period");
        }
        if at > c.end_block {
            return reject(self, "change after the coverage ended");
        }
        let view = |m: &str, a: serde_json::Value| Promise::new(c.vault.clone()).function_call(m.to_string(), a.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_VIEW);
        PromiseOrValue::Promise(
            view("exposure_before", json!({ "agent": c.agent, "target": c.target, "token": c.token, "block": at }))
                .and(view("exposure_before", json!({ "agent": c.agent, "target": c.target, "token": c.token, "block": c.start_block })))
                .and(view("get_agent", json!({ "public_key": c.agent })))
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_CLAIM).cb_claim_pay(coverage_id, report_id)),
        )
    }

    #[private]
    pub fn cb_claim_pay(&mut self, coverage_id: u32, report_id: u32) -> U128 {
        let c = self.coverages.get(coverage_id).cloned().unwrap();
        // Only exposure recorded inside this coverage's window counts: before the change, and not before
        // the purchase. Exposure from earlier was not priced (the reachable payout assumes at most
        // daily_cap x days inside the window, D-55).
        let (Some(until_change), Some(until_start)) = (result::<U128>(0), result::<U128>(1)) else {
            self.finish_claim(coverage_id, report_id, 0, "vault did not answer exposure_before");
            return U128(0);
        };
        let exposure = U128(until_change.0.saturating_sub(until_start.0));
        let Some(Some(agent)) = result::<Option<AgentView>>(2) else {
            self.finish_claim(coverage_id, report_id, 0, "vault did not answer get_agent");
            return U128(0);
        };
        if agent.last_loosened_at >= c.start_block {
            self.finish_claim(coverage_id, report_id, 0, "policy loosened after purchase");
            return U128(0);
        }
        let owed = (exposure.0 * c.payout_ratio_bps as u128 / 10_000).min(c.limit.0 - c.paid_out.0);
        if owed == 0 {
            self.finish_claim(coverage_id, report_id, 0, "no exposure recorded before the change, or limit exhausted");
            return U128(0);
        }
        let mut b = self.book(&c.token);
        if owed > b.capital.0 {
            self.finish_claim(coverage_id, report_id, 0, "book capital is insufficient");
            return U128(0);
        }
        b.capital = U128(b.capital.0 - owed);
        b.total_limits = U128(b.total_limits.0.saturating_sub(owed));
        self.books.insert(c.token.clone(), b);
        for (map_key_hash, map_key_auth) in [((c.token.clone(), c.code_hash.clone()), (c.token.clone(), c.upgrade_authority.clone()))] {
            let h = self.by_hash.get(&map_key_hash).copied().unwrap_or(0);
            self.by_hash.insert(map_key_hash, h.saturating_sub(owed));
            let a = self.by_authority.get(&map_key_auth).copied().unwrap_or(0);
            self.by_authority.insert(map_key_auth, a.saturating_sub(owed));
        }
        emit(
            "claim_paid",
            json!({ "coverage": coverage_id, "report": report_id, "exposure_in_window": exposure, "exposure_before_change": until_change, "exposure_before_purchase": until_start, "payout_ratio_bps": c.payout_ratio_bps, "limit": c.limit, "paid_before": c.paid_out, "payout": U128(owed), "to": c.owner, "token": c.token }),
        );
        pay(&c.token, &c.owner, owed);
        self.finish_claim(coverage_id, report_id, owed, "paid");
        U128(owed)
    }
}

impl Pool {
    fn finish_claim(&mut self, coverage_id: u32, report_id: u32, paid: u128, outcome: &str) {
        let c = self.coverages.get_mut(coverage_id).unwrap();
        c.claim_in_flight = false;
        c.paid_out = U128(c.paid_out.0 + paid);
        c.claims.push(ClaimRecord { report_id, paid: U128(paid), outcome: outcome.to_string(), block: env::block_height() });
        if paid == 0 {
            emit("claim_rejected", json!({ "coverage": coverage_id, "report": report_id, "reason": outcome }));
        }
    }
}

#[cfg(test)]
mod tests;
