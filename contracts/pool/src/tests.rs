//! Purchase and claim callbacks driven with simulated promise results (plan U5). The cross-contract
//! paths themselves run on a sandbox in contracts/integration (plan U7).
use crate::*;
use aruna_common::params::{BLOCKS_PER_DAY, WAITING_PERIOD_BLOCKS};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult};

const NEAR: u128 = 10u128.pow(24);
const NOW: u64 = 1_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn agent_pk() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
}
fn usdc() -> TokenId {
    TokenId::Ft(acc("usdc.testnet"))
}
fn ctx(who: &str, height: u64, deposit: u128, results: Vec<PromiseResult>) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acc("pool.testnet"))
            .predecessor_account_id(acc(who))
            .block_height(height)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(1_000))
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}
fn ok(v: serde_json::Value) -> PromiseResult {
    PromiseResult::Successful(v.to_string().into_bytes())
}
fn pool_with_capital(near: u128) -> Pool {
    ctx("owner.testnet", NOW, 0, vec![]);
    let mut p = Pool::new(acc("owner.testnet"), acc("registry.testnet"));
    if near > 0 {
        ctx("underwriter.testnet", NOW, near, vec![]);
        p.deposit();
    }
    p
}
fn request(target: &str, limit: u128) -> BuyRequest {
    BuyRequest { vault: acc("v.factory.testnet"), agent: agent_pk(), target: acc(target), limit: U128(limit), payout_ratio_bps: 8_000, window_blocks: BLOCKS_PER_DAY }
}
fn purchase_results(owner: &str, class: &str, hash: &str, fresh: bool, daily_cap: u128, max_class: &str, token: serde_json::Value, loosened: u64) -> Vec<PromiseResult> {
    vec![
        ok(json!({ "vault": "v.factory.testnet", "owner": owner, "code_hash": "V3", "registered_at_block": 1 })),
        ok(json!({ "class": class, "evidence_hash": "E", "classified_at_block": 1, "classifier": "c.testnet", "frozen": false, "resolved_code_hash": hash, "upgrade_authority": "owner-of-code.testnet" })),
        ok(json!(fresh)),
        ok(json!({ "label": "a", "status": "Active", "policy": { "limits": [{ "token": token, "max_per_tx": "1", "daily_cap": daily_cap.to_string() }], "max_slippage_bps": 50, "allowed_targets": ["t.testnet", "t2.testnet"], "max_risk_class": max_class }, "policy_version": 3, "last_loosened_at": loosened, "created_at": 1, "auto_disabled": false, "budgets": [], "refusals": [] })),
    ]
}
fn buy(p: &mut Pool, req: BuyRequest, token: TokenId, paid: u128, results: Vec<PromiseResult>) -> U128 {
    ctx("pool.testnet", NOW, 0, results);
    p.cb_buy(acc("client.testnet"), token, U128(paid), req)
}
fn refused_reason() -> Option<String> {
    get_logs().iter().find(|l| l.contains("coverage_refused")).map(|l| l.clone())
}
fn premium(class: RiskClass, limit: u128, cap: u128) -> u128 {
    pricing::quote(class, limit, 8_000, BLOCKS_PER_DAY, cap).unwrap().premium.0
}

#[test]
fn the_owner_buys_and_the_coverage_records_the_policy_it_was_priced_on() {
    let mut p = pool_with_capital(10 * NEAR);
    let prem = premium(RiskClass::LocalUpgradeable, 5 * NEAR, NEAR);
    buy(&mut p, request("t.testnet", 5 * NEAR), TokenId::Near, prem, purchase_results("client.testnet", "local_upgradeable", "H1", true, NEAR, "local_upgradeable", json!("near"), 0));
    assert_eq!(refused_reason(), None, "{:?}", get_logs());
    let c = p.get_coverage(0).unwrap();
    assert_eq!((c.policy_version, c.daily_cap_priced, c.premium_paid), (3, U128(NEAR), U128(prem)));
    assert_eq!(c.waiting_period_ends, NOW + WAITING_PERIOD_BLOCKS);
    assert_eq!(p.get_book(TokenId::Near).capital, U128(10 * NEAR + prem));
}

#[test]
fn a_class_above_max_risk_class_is_refused() {
    let mut p = pool_with_capital(10 * NEAR);
    buy(&mut p, request("t.testnet", NEAR), TokenId::Near, NEAR, purchase_results("client.testnet", "global_by_account", "H1", true, NEAR, "local_upgradeable", json!("near"), 0));
    assert!(refused_reason().unwrap().contains("max_risk_class"));
    assert!(p.get_coverage(0).is_none());
}

#[test]
fn unknown_targets_are_refused() {
    let mut p = pool_with_capital(10 * NEAR);
    buy(&mut p, request("t.testnet", NEAR), TokenId::Near, NEAR, purchase_results("client.testnet", "unknown", "H1", true, NEAR, "unknown", json!("near"), 0));
    assert!(refused_reason().unwrap().contains("not insurable"));
}

#[test]
fn the_operator_cannot_buy() {
    let mut p = pool_with_capital(10 * NEAR);
    buy(&mut p, request("t.testnet", NEAR), TokenId::Near, NEAR, purchase_results("company.testnet", "local_upgradeable", "H1", true, NEAR, "local_upgradeable", json!("near"), 0));
    assert!(refused_reason().unwrap().contains("only the vault's owner"));
}

#[test]
fn a_stale_heartbeat_refuses_new_coverage() {
    // Covers AE8.
    let mut p = pool_with_capital(10 * NEAR);
    buy(&mut p, request("t.testnet", NEAR), TokenId::Near, NEAR, purchase_results("client.testnet", "local_upgradeable", "H1", false, NEAR, "local_upgradeable", json!("near"), 0));
    assert!(refused_reason().unwrap().contains("heartbeat"));
}

#[test]
fn a_premium_below_the_quote_is_refused() {
    let mut p = pool_with_capital(10 * NEAR);
    let prem = premium(RiskClass::LocalUpgradeable, 5 * NEAR, NEAR);
    buy(&mut p, request("t.testnet", 5 * NEAR), TokenId::Near, prem - 1, purchase_results("client.testnet", "local_upgradeable", "H1", true, NEAR, "local_upgradeable", json!("near"), 0));
    assert!(refused_reason().unwrap().contains("below the quote"));
}

#[test]
fn capital_adequacy_is_enforced_at_purchase() {
    // k = 5 with 10 NEAR of capital: 60 NEAR of limits is refused; 19 NEAR (also under the 2x
    // concentration bound on one code hash) is accepted.
    let mut p = pool_with_capital(10 * NEAR);
    buy(&mut p, request("t.testnet", 60 * NEAR), TokenId::Near, NEAR, purchase_results("client.testnet", "immutable_verified", "H1", true, NEAR / 100, "local_upgradeable", json!("near"), 0));
    assert!(refused_reason().unwrap().contains("capital adequacy"));
    let mut p = pool_with_capital(10 * NEAR);
    buy(&mut p, request("t.testnet", 19 * NEAR), TokenId::Near, NEAR, purchase_results("client.testnet", "immutable_verified", "H1", true, NEAR / 100, "local_upgradeable", json!("near"), 0));
    assert_eq!(refused_reason(), None, "{:?}", get_logs());
}

#[test]
fn concentration_is_per_code_hash_across_different_targets() {
    // CONCENTRATION_BPS = 20,000: at most 2 × capital on one resolved code hash.
    let mut p = pool_with_capital(10 * NEAR);
    buy(&mut p, request("t.testnet", 15 * NEAR), TokenId::Near, NEAR, purchase_results("client.testnet", "immutable_verified", "SAME", true, NEAR / 100, "local_upgradeable", json!("near"), 0));
    assert_eq!(refused_reason(), None, "{:?}", get_logs());
    buy(&mut p, request("t2.testnet", 10 * NEAR), TokenId::Near, NEAR, purchase_results("client.testnet", "immutable_verified", "SAME", true, NEAR / 100, "local_upgradeable", json!("near"), 0));
    assert!(refused_reason().unwrap().contains("concentration"));
}

#[test]
fn a_usdc_purchase_touches_only_the_usdc_book() {
    // Covers AE7.
    let mut p = pool_with_capital(10 * NEAR);
    ctx("usdc.testnet", NOW, 0, vec![]);
    let _ = p.ft_on_transfer(acc("underwriter.testnet"), U128(1_000_000_000), "{\"action\":\"deposit\"}".into());
    let prem = premium(RiskClass::LocalUpgradeable, 100_000_000, 10_000_000);
    let back = buy(&mut p, request("t.testnet", 100_000_000), usdc(), prem + 5, purchase_results("client.testnet", "local_upgradeable", "H1", true, 10_000_000, "local_upgradeable", json!({ "ft": "usdc.testnet" }), 0));
    assert_eq!(back, U128(5), "the excess goes back through ft_resolve_transfer");
    assert_eq!(p.get_book(usdc()).capital, U128(1_000_000_000 + prem));
    assert_eq!(p.get_book(TokenId::Near).capital, U128(10 * NEAR));
    assert_eq!(p.get_book(TokenId::Near).total_limits, U128(0));
}

#[test]
fn a_usdc_refusal_returns_the_whole_amount() {
    let mut p = pool_with_capital(0);
    let back = buy(&mut p, request("t.testnet", 1), usdc(), 777, purchase_results("company.testnet", "local_upgradeable", "H1", true, 1, "local_upgradeable", json!({ "ft": "usdc.testnet" }), 0));
    assert_eq!(back, U128(777));
}

// ---- claims ----

fn covered_pool() -> Pool {
    let mut p = pool_with_capital(10 * NEAR);
    buy(&mut p, request("t.testnet", 10 * NEAR), TokenId::Near, NEAR, purchase_results("client.testnet", "local_upgradeable", "H1", true, NEAR, "local_upgradeable", json!("near"), 0));
    assert!(p.get_coverage(0).is_some(), "{:?}", get_logs());
    p
}
fn report(state: &str, target: &str, changed: u64) -> PromiseResult {
    ok(json!({ "id": 0, "report": { "target": target, "changed_at_block": changed }, "reported_at_block": changed + 5, "state": state, "disputed_by": null }))
}
fn allowed() -> PromiseResult {
    ok(json!({ "vault": "v.factory.testnet", "owner": "client.testnet", "code_hash": "V3", "registered_at_block": 1 }))
}
fn claim_stage1(p: &mut Pool, results: Vec<PromiseResult>) {
    claim_on(p, 0, results)
}
/// The change block the tests give each report: report 0 changed at NOW+200, report 1 at NOW+300.
fn changed_of(report_id: u32) -> u64 {
    NOW + 200 + 100 * report_id as u64
}
fn claim_on(p: &mut Pool, report_id: u32, results: Vec<PromiseResult>) {
    ctx("anyone.testnet", NOW + 500, 0, vec![]);
    let _ = p.claim(0, report_id);
    ctx("pool.testnet", NOW + 500, 0, results);
    let _ = p.cb_claim_report(0, report_id);
}
fn last_outcome(p: &Pool) -> String {
    p.get_coverage(0).unwrap().claims.last().unwrap().outcome.clone()
}

#[test]
fn a_claim_against_a_pending_or_disputed_report_is_refused_with_the_reason() {
    // Covers AE5.
    let mut p = covered_pool();
    claim_stage1(&mut p, vec![report("pending", "t.testnet", NOW + 200), allowed()]);
    assert_eq!(last_outcome(&p), "challenge window still open");
    claim_stage1(&mut p, vec![report("disputed", "t.testnet", NOW + 200), allowed()]);
    assert_eq!(last_outcome(&p), "report is disputed");
    assert!(!p.get_coverage(0).unwrap().claim_in_flight);
}

#[test]
fn a_change_inside_the_waiting_period_is_rejected() {
    let mut p = covered_pool();
    claim_stage1(&mut p, vec![report("verified", "t.testnet", NOW + WAITING_PERIOD_BLOCKS - 1), allowed()]);
    assert_eq!(last_outcome(&p), "change inside the waiting period");
}

#[test]
fn a_vault_no_longer_on_an_allowed_code_hash_is_rejected() {
    // Covers AE9.
    let mut p = covered_pool();
    claim_stage1(&mut p, vec![report("verified", "t.testnet", NOW + 200), ok(json!(null))]);
    assert_eq!(last_outcome(&p), "vault is not on an allowed code hash");
}

fn agent_view(loosened: u64) -> PromiseResult {
    ok(json!({ "status": "Active", "policy": { "limits": [], "allowed_targets": [], "max_risk_class": "local_upgradeable" }, "policy_version": 4, "last_loosened_at": loosened }))
}
fn pay_stage(p: &mut Pool, exposure: u128, loosened: u64) -> U128 {
    pay_on(p, 0, exposure, loosened)
}
fn pay_on(p: &mut Pool, report_id: u32, exposure: u128, loosened: u64) -> U128 {
    pay_window(p, report_id, exposure, 0, loosened)
}
fn pay_window(p: &mut Pool, report_id: u32, before_change: u128, before_purchase: u128, loosened: u64) -> U128 {
    ctx("pool.testnet", NOW + 501, 0, vec![ok(json!(U128(before_change))), ok(json!(U128(before_purchase))), agent_view(loosened)]);
    p.cb_claim_pay(0, report_id, changed_of(report_id))
}

#[test]
fn payout_is_exposure_before_the_change_times_the_ratio() {
    // Covers AE6: 3 NEAR recorded before changed_at_block, ratio 80%, C = 10 → 2.4 NEAR.
    let mut p = covered_pool();
    let before = p.get_book(TokenId::Near).capital.0;
    claim_stage1(&mut p, vec![report("verified", "t.testnet", NOW + 200), allowed()]);
    assert_eq!(pay_stage(&mut p, 3 * NEAR, 0), U128(24 * NEAR / 10));
    assert_eq!(last_outcome(&p), "paid");
    assert_eq!(p.get_book(TokenId::Near).capital.0, before - 24 * NEAR / 10);
    assert!(get_logs().iter().any(|l| l.contains("claim_paid") && l.contains("\"exposure_in_window\"")));
}

#[test]
fn exposure_recorded_before_the_purchase_does_not_count() {
    // Found on testnet: the same agent had swapped 0.1 NEAR before this coverage was bought.
    let mut p = covered_pool();
    claim_stage1(&mut p, vec![report("verified", "t.testnet", NOW + 200), allowed()]);
    assert_eq!(pay_window(&mut p, 0, 2 * NEAR / 10, NEAR / 10, 0), U128(8 * NEAR / 100), "only the 0.1 NEAR inside the window, x 80%");
}

#[test]
fn a_loosened_policy_voids_the_claim() {
    // Covers AE3: loosened at any block from purchase on, even if tightened back later.
    let mut p = covered_pool();
    claim_stage1(&mut p, vec![report("verified", "t.testnet", NOW + 200), allowed()]);
    assert_eq!(pay_stage(&mut p, 3 * NEAR, NOW + 10), U128(0));
    assert_eq!(last_outcome(&p), "policy loosened after purchase");
}

#[test]
fn payouts_never_exceed_the_limit_across_claims() {
    let mut p = covered_pool();
    claim_stage1(&mut p, vec![report("verified", "t.testnet", NOW + 200), allowed()]);
    assert_eq!(pay_stage(&mut p, 11 * NEAR, 0), U128(88 * NEAR / 10));
    claim_on(&mut p, 1, vec![report("verified", "t.testnet", NOW + 300), allowed()]);
    assert_eq!(pay_on(&mut p, 1, 11 * NEAR, 0), U128(12 * NEAR / 10), "only the remaining 1.2 NEAR of C");
}

#[test]
fn underwriter_capital_is_locked_until_coverage_and_reporting_end() {
    let mut p = covered_pool();
    let locked = p.get_book(TokenId::Near).locked_until;
    ctx("underwriter.testnet", locked - 1, 1, vec![]);
    let shares = p.get_shares(acc("underwriter.testnet"), TokenId::Near);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut q = covered_pool();
        ctx("underwriter.testnet", q.get_book(TokenId::Near).locked_until - 1, 1, vec![]);
        q.withdraw(TokenId::Near, shares);
    }));
    assert!(r.is_err());
    ctx("underwriter.testnet", locked, 1, vec![]);
    p.withdraw(TokenId::Near, shares);
    assert_eq!(p.get_shares(acc("underwriter.testnet"), TokenId::Near), U128(0));
}

#[test]
#[should_panic(expected = "ARUNA_ALREADY_PAID")]
fn the_same_report_cannot_be_paid_twice() {
    let mut p = covered_pool();
    claim_stage1(&mut p, vec![report("verified", "t.testnet", NOW + 200), allowed()]);
    pay_stage(&mut p, NEAR, 0);
    ctx("anyone.testnet", NOW + 600, 0, vec![]);
    let _ = p.claim(0, 0);
}

#[test]
fn mul_div_handles_yocto_sized_products() {
    let a = 10 * NEAR;
    assert_eq!(mul_div(a, 37 * NEAR, 37 * NEAR), a);
    assert_eq!(mul_div(u128::MAX, 2, 4), u128::MAX / 2);
    assert_eq!(mul_div(7, 3, 2), 10);
}

#[test]
#[should_panic(expected = "ARUNA_NOT_REGISTRY")]
fn only_the_registry_sends_slashed_bonds() {
    let mut p = pool_with_capital(0);
    ctx("stranger.testnet", NOW, NEAR, vec![]);
    p.receive_slash(acc("attestor.testnet"));
}

#[test]
fn expired_coverage_stops_holding_capacity() {
    let mut p = covered_pool();
    let c = p.get_coverage(0).unwrap();
    let limits = p.get_book(TokenId::Near).total_limits;
    ctx("anyone.testnet", c.end_block + aruna_common::params::CLAIM_REPORTING_BLOCKS - 1, 0, vec![]);
    assert_eq!(p.release_expired(vec![0]), 0, "not before the reporting period ends");
    ctx("anyone.testnet", c.end_block + aruna_common::params::CLAIM_REPORTING_BLOCKS, 0, vec![]);
    assert_eq!(p.release_expired(vec![0, 0, 99]), 1, "once, and unknown ids are skipped");
    assert_eq!(p.get_book(TokenId::Near).total_limits.0, limits.0 - c.limit.0);
    assert!(p.get_coverage(0).unwrap().released);
}

// ---- found in review ----

fn buy_with(window: u64, limit: u128, ratio: u16, cap: u128) -> (Pool, Option<String>) {
    let mut p = pool_with_capital(10 * NEAR);
    let mut req = request("t.testnet", limit);
    req.window_blocks = window;
    req.payout_ratio_bps = ratio;
    let r = purchase_results("client.testnet", "local_upgradeable", "H1", true, cap, "local_upgradeable", json!("near"), 0);
    buy(&mut p, req, TokenId::Near, NEAR, r);
    let reason = refused_reason();
    (p, reason)
}

#[test]
fn bad_requests_are_refusals_that_return_the_premium_not_panics() {
    // A panic in cb_buy would strand the NEAR the buyer already sent.
    for (window, limit, ratio, cap, why) in [
        (WAITING_PERIOD_BLOCKS, NEAR, 8_000, NEAR, "window must be longer"),
        (aruna_common::params::MAX_COVERAGE_WINDOW_BLOCKS + 1, NEAR, 8_000, NEAR, "within the maximum window"),
        (BLOCKS_PER_DAY, 0, 8_000, NEAR, "limit must be positive"),
        (BLOCKS_PER_DAY, NEAR, 0, NEAR, "payout ratio"),
        (BLOCKS_PER_DAY, NEAR, 10_001, NEAR, "payout ratio"),
        (BLOCKS_PER_DAY, u128::MAX / 2, 8_000, NEAR, "limit must be positive"),
        (BLOCKS_PER_DAY, NEAR, 8_000, 0, "no daily cap"),
    ] {
        let (p, reason) = buy_with(window, limit, ratio, cap);
        assert!(reason.unwrap_or_default().contains(why), "{why}");
        assert!(p.get_coverage(0).is_none());
    }
}

#[test]
fn an_agent_with_a_huge_daily_cap_prices_at_the_limit_instead_of_overflowing() {
    let q = pricing::quote(RiskClass::LocalUpgradeable, 5 * NEAR, 10_000, 30 * BLOCKS_PER_DAY, u128::MAX / 2).unwrap();
    assert_eq!(q.reachable_payout, U128(5 * NEAR));
    let (p, reason) = buy_with(BLOCKS_PER_DAY, NEAR, 8_000, u128::MAX / 2);
    assert_eq!(reason, None, "{:?}", get_logs());
    assert!(p.get_coverage(0).is_some());
}

#[test]
fn a_claim_needs_enough_gas_and_a_stuck_one_expires() {
    let mut p = covered_pool();
    ctx("anyone.testnet", NOW + 500, 0, vec![]);
    let _ = p.claim(0, 0);
    assert!(p.get_coverage(0).unwrap().claim_in_flight);
    // Its callbacks never arrive. Within the timeout a second claim is refused...
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut q = covered_pool_in_flight();
        ctx("anyone.testnet", NOW + 500 + aruna_common::params::CLAIM_TIMEOUT_BLOCKS - 1, 0, vec![]);
        let _ = q.claim(0, 0);
    }));
    assert!(again.is_err());
    // ...after it, the claim may be retried.
    ctx("anyone.testnet", NOW + 500 + aruna_common::params::CLAIM_TIMEOUT_BLOCKS, 0, vec![]);
    let _ = p.claim(0, 0);
}

fn covered_pool_in_flight() -> Pool {
    let mut p = covered_pool();
    ctx("anyone.testnet", NOW + 500, 0, vec![]);
    let _ = p.claim(0, 0);
    p
}

#[test]
#[should_panic(expected = "ARUNA_NOT_ENOUGH_GAS")]
fn a_claim_with_too_little_gas_is_refused_up_front() {
    let mut p = covered_pool();
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("pool.testnet"))
        .predecessor_account_id(acc("anyone.testnet"))
        .block_height(NOW + 500)
        .prepaid_gas(near_sdk::Gas::from_tgas(60))
        .build());
    let _ = p.claim(0, 0);
}

#[test]
fn one_change_is_never_paid_twice() {
    // Two reports that agree (both Verified) for the same change: the second finds it already paid.
    let mut p = covered_pool();
    claim_on(&mut p, 0, vec![report("verified", "t.testnet", NOW + 200), allowed()]);
    assert_eq!(pay_on(&mut p, 0, 2 * NEAR / 10, 0), U128(16 * NEAR / 100));
    // Report 1 claims the same change one block later: nothing new was recorded after the first change.
    claim_on(&mut p, 1, vec![report("verified", "t.testnet", NOW + 200), allowed()]);
    assert_eq!(last_outcome(&p), "change already covered by an earlier payout");
    let c = p.get_coverage(0).unwrap();
    assert_eq!((c.paid_out, c.paid_through_block), (U128(16 * NEAR / 100), NOW + 200));
}

#[test]
fn a_later_change_pays_only_exposure_recorded_after_the_earlier_payout() {
    let mut p = covered_pool();
    claim_on(&mut p, 0, vec![report("verified", "t.testnet", NOW + 200), allowed()]);
    assert_eq!(pay_on(&mut p, 0, NEAR / 10, 0), U128(8 * NEAR / 100));
    // A second change at NOW+300: 0.3 NEAR recorded before it in total, 0.1 of it through the first.
    claim_on(&mut p, 1, vec![report("verified", "t.testnet", NOW + 300), allowed()]);
    assert_eq!(pay_window(&mut p, 1, 3 * NEAR / 10, NEAR / 10, 0), U128(16 * NEAR / 100), "only the 0.2 NEAR after the first change, x 80%");
}

#[test]
#[should_panic(expected = "ARUNA_DEPOSIT_TOO_SMALL")]
fn a_deposit_that_rounds_to_no_shares_is_refused() {
    // Capital has grown far past the shares (premiums, slashed bonds): a 1 yocto deposit mints none.
    let mut p = pool_with_capital(0);
    ctx("first.testnet", NOW, 1, vec![]);
    p.deposit();
    ctx("registry.testnet", NOW, 5 * NEAR, vec![]);
    p.receive_slash(acc("attestor.testnet"));
    ctx("victim.testnet", NOW, 1, vec![]);
    p.deposit();
}

// ---- golden vectors for packages/sim (plan U17, KTD11) ----
//
// The TypeScript model in packages/sim re-implements the pool's premium, adequacy, concentration, release
// and payout rules. Both sides read fixtures/golden/pool-rules.json: this test drives the REAL pool
// (through the same simulated promise results as the tests above) and fails if its answers differ from the
// file; the model's test fails if its answers differ from the same file. Regenerate after a deliberate
// rule change with `ARUNA_WRITE_GOLDEN=1 cargo test -p aruna-pool golden`, and read the diff.
mod golden {
    use super::*;
    use aruna_common::params::{CAPITAL_COST_BPS_30D, CLAIM_REPORTING_BLOCKS, CONCENTRATION_BPS, K_X100, RISK_MARGIN_BPS};
    use serde_json::{json, Value};

    const GOLDEN: &str = "../../fixtures/golden/pool-rules.json";

    fn s(n: u128) -> Value {
        json!(n.to_string())
    }
    fn class_name(c: RiskClass) -> &'static str {
        match c {
            RiskClass::ImmutableVerified => "immutable_verified",
            RiskClass::LocalUpgradeable => "local_upgradeable",
            RiskClass::GlobalByAccount => "global_by_account",
            RiskClass::Unknown => "unknown",
        }
    }

    /// The four reads a purchase makes, with the code hash and upgrade authority the target resolves to.
    fn results_for(class: &str, hash: &str, authority: &str, daily_cap: u128) -> Vec<PromiseResult> {
        vec![
            ok(json!({ "vault": "v.factory.testnet", "owner": "client.testnet", "code_hash": "V3", "registered_at_block": 1 })),
            ok(json!({ "class": class, "evidence_hash": "E", "classified_at_block": 1, "classifier": "c.testnet", "frozen": false, "resolved_code_hash": hash, "upgrade_authority": authority })),
            ok(json!(true)),
            ok(json!({ "label": "a", "status": "Active", "policy": { "limits": [{ "token": "near", "max_per_tx": "1", "daily_cap": daily_cap.to_string() }], "max_slippage_bps": 50, "allowed_targets": ["t.testnet"], "max_risk_class": "global_by_account" }, "policy_version": 3, "last_loosened_at": 0, "created_at": 1, "auto_disabled": false, "budgets": [], "refusals": [] })),
        ]
    }

    fn quotes() -> Vec<Value> {
        let mut out = vec![];
        let classes = [RiskClass::ImmutableVerified, RiskClass::LocalUpgradeable, RiskClass::GlobalByAccount, RiskClass::Unknown];
        let windows = [1u64, BLOCKS_PER_DAY, 5 * BLOCKS_PER_DAY, 30 * BLOCKS_PER_DAY];
        let shapes = [(10 * NEAR, NEAR, 8_000u16), (10 * NEAR, 5 * NEAR, 8_000), (100 * NEAR, 2 * NEAR, 5_000), (3 * NEAR, 10 * NEAR, 10_000), (50 * NEAR, 1_234_567_890_123_456_789_012_345 / 100, 7_500)];
        for class in classes {
            for window in windows {
                for (limit, cap, ratio) in shapes {
                    let v = match pricing::quote(class, limit, ratio, window, cap) {
                        None => json!({ "class": class_name(class), "limit": s(limit), "payout_ratio_bps": ratio, "window_blocks": window, "daily_cap": s(cap), "insurable": false }),
                        Some(q) => json!({
                            "class": class_name(class), "limit": s(limit), "payout_ratio_bps": ratio, "window_blocks": window, "daily_cap": s(cap), "insurable": true,
                            "days": q.days, "reachable": s(q.reachable_payout.0), "expected_loss": s(q.expected_loss.0), "premium": s(q.premium.0),
                        }),
                    };
                    out.push(v);
                }
            }
        }
        out
    }

    struct Buy<'a> {
        class: &'a str,
        hash: &'a str,
        authority: &'a str,
        limit: u128,
        daily_cap: u128,
        ratio: u16,
        window: u64,
    }
    enum Step<'a> {
        Buy(u64, Buy<'a>),
        Release(u64, Vec<u32>),
    }

    /// The mock storage near-sdk gives a test is thread-local and shared by every pool made in it, so each
    /// run gets a thread of its own: otherwise one run's books leak into the next.
    fn isolated<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        std::thread::spawn(f).join().expect("a golden run panicked")
    }

    fn purchase_run(name: &'static str, capital: u128, steps: Vec<Step<'static>>) -> Value {
        isolated(move || purchase_run_in_this_thread(name, capital, steps))
    }

    fn purchase_run_in_this_thread(name: &str, capital: u128, steps: Vec<Step<'static>>) -> Value {
        let mut p = pool_with_capital(capital);
        let mut out = vec![];
        for st in steps {
            match st {
                Step::Buy(at, b) => {
                    let class = match b.class {
                        "immutable_verified" => RiskClass::ImmutableVerified,
                        "local_upgradeable" => RiskClass::LocalUpgradeable,
                        _ => RiskClass::GlobalByAccount,
                    };
                    let q = pricing::quote(class, b.limit, b.ratio, b.window, b.daily_cap).unwrap();
                    let req = BuyRequest { vault: acc("v.factory.testnet"), agent: agent_pk(), target: acc("t.testnet"), limit: U128(b.limit), payout_ratio_bps: b.ratio, window_blocks: b.window };
                    ctx("pool.testnet", at, 0, results_for(b.class, b.hash, b.authority, b.daily_cap));
                    let _ = p.cb_buy(acc("client.testnet"), TokenId::Near, U128(q.premium.0), req);
                    let reason = refused_reason().map(|l| if l.contains("capital adequacy") { "capital_adequacy" } else if l.contains("concentration") { "concentration" } else { "other" });
                    let book = p.get_book(TokenId::Near);
                    out.push(json!({
                        "op": "buy", "at_block": at, "class": b.class, "hash": b.hash, "authority": b.authority, "limit": s(b.limit), "daily_cap": s(b.daily_cap),
                        "payout_ratio_bps": b.ratio, "window_blocks": b.window,
                        "accepted": reason.is_none(), "reason": reason, "premium": s(q.premium.0),
                        "capital_after": s(book.capital.0), "total_limits_after": s(book.total_limits.0), "locked_until": book.locked_until,
                    }));
                }
                Step::Release(at, ids) => {
                    ctx("anyone.testnet", at, 0, vec![]);
                    let n = p.release_expired(ids.clone());
                    let book = p.get_book(TokenId::Near);
                    out.push(json!({ "op": "release", "at_block": at, "ids": ids, "released": n, "total_limits_after": s(book.total_limits.0), "capital_after": s(book.capital.0) }));
                }
            }
        }
        json!({ "name": name, "capital": s(capital), "steps": out })
    }

    fn purchase_runs() -> Vec<Value> {
        let day = BLOCKS_PER_DAY;
        let b = |class: &'static str, hash: &'static str, authority: &'static str, limit: u128| Buy { class, hash, authority, limit, daily_cap: NEAR, ratio: 8_000, window: 30 * day };
        // Boundaries, to the last yoctoNEAR. A tiny daily cap makes the premium independent of the limit
        // (reachable payout = cap x days x ratio < limit), so each edge can be computed exactly:
        //   adequacy:      total limits <= k x (capital + premiums)
        //   concentration: limits on one hash or authority <= bps x (capital + premiums)
        let cap = NEAR / 100;
        let tiny = |hash: &'static str, authority: &'static str, limit: u128| Buy { class: "immutable_verified", hash, authority, limit, daily_cap: cap, ratio: 8_000, window: 30 * day };
        let prem = pricing::quote(RiskClass::ImmutableVerified, 100 * NEAR, 8_000, 30 * day, cap).unwrap().premium.0;
        let c0 = 10 * NEAR;
        let k_edge = K_X100 * (c0 + 3 * prem) / 100 - 38 * NEAR; // third purchase, after two of 19 NEAR
        let conc_edge = CONCENTRATION_BPS * (c0 + prem) / 10_000; // one purchase
        let conc_edge_2 = CONCENTRATION_BPS * (c0 + 2 * prem) / 10_000 - 10 * NEAR; // second purchase, 10 NEAR already
        let adequacy_edge = |over: u128| {
            vec![
                Step::Buy(NOW, tiny("H1", "a1.testnet", 19 * NEAR)),
                Step::Buy(NOW + 10, tiny("H2", "a2.testnet", 19 * NEAR)),
                Step::Buy(NOW + 20, tiny("H3", "a3.testnet", k_edge + over)),
            ]
        };
        vec![
            purchase_run("adequacy_boundary_exactly_at_k", c0, adequacy_edge(0)),
            purchase_run("adequacy_boundary_one_yocto_over", c0, adequacy_edge(1)),
            purchase_run("concentration_boundary_hash_exactly_at_limit", c0, vec![Step::Buy(NOW, tiny("H1", "a1.testnet", conc_edge))]),
            purchase_run("concentration_boundary_hash_one_yocto_over", c0, vec![Step::Buy(NOW, tiny("H1", "a1.testnet", conc_edge + 1))]),
            purchase_run("concentration_boundary_authority_exactly_at_limit", c0, vec![Step::Buy(NOW, tiny("H1", "a1.testnet", 10 * NEAR)), Step::Buy(NOW + 10, tiny("H2", "a1.testnet", conc_edge_2))]),
            purchase_run("concentration_boundary_authority_one_yocto_over", c0, vec![Step::Buy(NOW, tiny("H1", "a1.testnet", 10 * NEAR)), Step::Buy(NOW + 10, tiny("H2", "a1.testnet", conc_edge_2 + 1))]),
            // k = 5: capital 10 NEAR plus premiums admits about 50 NEAR of limits, then refuses.
            purchase_run("adequacy_ladder", 10 * NEAR, vec![
                Step::Buy(NOW, b("immutable_verified", "H1", "a1.testnet", 19 * NEAR)),
                Step::Buy(NOW + 10, b("immutable_verified", "H2", "a2.testnet", 19 * NEAR)),
                Step::Buy(NOW + 20, b("immutable_verified", "H3", "a3.testnet", 12 * NEAR)),
                Step::Buy(NOW + 30, b("immutable_verified", "H4", "a4.testnet", 5 * NEAR)),
                Step::Buy(NOW + 40, b("immutable_verified", "H5", "a5.testnet", NEAR)),
            ]),
            // The same code hash under different authorities, and the same authority over different hashes.
            purchase_run("concentration_by_hash_and_authority", 10 * NEAR, vec![
                Step::Buy(NOW, b("local_upgradeable", "SAME", "a1.testnet", 15 * NEAR)),
                Step::Buy(NOW + 10, b("local_upgradeable", "SAME", "a2.testnet", 10 * NEAR)),
                Step::Buy(NOW + 20, b("local_upgradeable", "H2", "a1.testnet", 10 * NEAR)),
                Step::Buy(NOW + 30, b("local_upgradeable", "H3", "a3.testnet", 15 * NEAR)),
                Step::Buy(NOW + 40, b("global_by_account", "H4", "a1.testnet", 4 * NEAR)),
            ]),
            // Premiums raise capital, so a refusal can turn into an acceptance later; expiry frees capacity.
            purchase_run("premiums_and_release", 4 * NEAR, vec![
                Step::Buy(NOW, Buy { class: "global_by_account", hash: "H1", authority: "a1.testnet", limit: 7 * NEAR, daily_cap: 3 * NEAR, ratio: 8_000, window: 30 * day }),
                Step::Buy(NOW + 10, Buy { class: "local_upgradeable", hash: "H2", authority: "a2.testnet", limit: 7 * NEAR, daily_cap: 3 * NEAR, ratio: 8_000, window: 30 * day }),
                Step::Buy(NOW + 20, Buy { class: "local_upgradeable", hash: "H3", authority: "a3.testnet", limit: 7 * NEAR, daily_cap: 3 * NEAR, ratio: 8_000, window: 30 * day }),
                Step::Release(NOW + 100, vec![0, 1, 2]),
                // Each coverage is released at its own end + reporting period, and not one block before.
                Step::Release(NOW + 30 * day + CLAIM_REPORTING_BLOCKS - 1, vec![0, 1, 2]),
                Step::Release(NOW + 30 * day + CLAIM_REPORTING_BLOCKS, vec![0, 1, 2]),
                Step::Release(NOW + 30 * day + CLAIM_REPORTING_BLOCKS + 9, vec![0, 1, 2]),
                Step::Release(NOW + 30 * day + CLAIM_REPORTING_BLOCKS + 10, vec![0, 1, 2]),
                Step::Release(NOW + 30 * day + CLAIM_REPORTING_BLOCKS + 100, vec![0, 1, 2, 0]),
                Step::Buy(NOW + 30 * day + CLAIM_REPORTING_BLOCKS + 200, Buy { class: "local_upgradeable", hash: "H1", authority: "a1.testnet", limit: 12 * NEAR, daily_cap: 3 * NEAR, ratio: 8_000, window: 10 * day }),
            ]),
        ]
    }

    /// One coverage of `limit` bought into a pool of `capital`, then claims for changes at NOW+200, NOW+300.
    fn payout_run(name: &'static str, capital: u128, limit: u128, ratio: u16, claims: &'static [(u128, u128)]) -> Value {
        isolated(move || payout_run_in_this_thread(name, capital, limit, ratio, claims))
    }

    fn payout_run_in_this_thread(name: &str, capital: u128, limit: u128, ratio: u16, claims: &[(u128, u128)]) -> Value {
        let mut p = pool_with_capital(capital);
        let req = BuyRequest { vault: acc("v.factory.testnet"), agent: agent_pk(), target: acc("t.testnet"), limit: U128(limit), payout_ratio_bps: ratio, window_blocks: BLOCKS_PER_DAY };
        let q = pricing::quote(RiskClass::LocalUpgradeable, limit, ratio, BLOCKS_PER_DAY, NEAR).unwrap();
        ctx("pool.testnet", NOW, 0, results_for("local_upgradeable", "H1", "a1.testnet", NEAR));
        let _ = p.cb_buy(acc("client.testnet"), TokenId::Near, U128(q.premium.0), req);
        assert!(p.get_coverage(0).is_some(), "{name}: the coverage was not bought: {:?}", get_logs());
        let mut out = vec![];
        for (i, (before_change, before_start)) in claims.iter().enumerate() {
            let id = i as u32;
            claim_on(&mut p, id, vec![report("verified", "t.testnet", changed_of(id)), allowed()]);
            let owed = pay_window(&mut p, id, *before_change, *before_start, 0).0;
            let book = p.get_book(TokenId::Near);
            out.push(json!({
                "exposure_before_change": s(*before_change), "exposure_before_start": s(*before_start),
                "owed": s(owed), "outcome": last_outcome(&p), "capital_after": s(book.capital.0), "total_limits_after": s(book.total_limits.0),
            }));
        }
        json!({ "name": name, "capital": s(capital), "limit": s(limit), "payout_ratio_bps": ratio, "premium": s(q.premium.0), "claims": out })
    }

    fn payout_runs() -> Vec<Value> {
        vec![
            payout_run("exposure_times_ratio", 10 * NEAR, 10 * NEAR, 8_000, &[(3 * NEAR, 0)]),
            payout_run("capped_by_the_remaining_limit_across_claims", 10 * NEAR, 10 * NEAR, 8_000, &[(11 * NEAR, 0), (22 * NEAR, 11 * NEAR)]),
            payout_run("exposure_before_purchase_does_not_count", 10 * NEAR, 10 * NEAR, 8_000, &[(2 * NEAR / 10, NEAR / 10)]),
            payout_run("ratio_below_one", 10 * NEAR, 10 * NEAR, 5_000, &[(4 * NEAR, 0)]),
            // 75% of 3 NEAR + 5 yocto is 2.25 NEAR + 3.75 yocto: the contract rounds down.
            payout_run("payout_rounds_down", 10 * NEAR, 10 * NEAR, 7_500, &[(3 * NEAR + 5, 0)]),
            payout_run("no_exposure", 10 * NEAR, 10 * NEAR, 8_000, &[(0, 0)]),
            // The pool pays all of a claim or none of it: a claim above the book's capital is unpaid. 5 NEAR of
            // capital admits a 10 NEAR limit on one hash (concentration is 2 x capital), and 80% of 11 NEAR
            // owed is 8.8: one change on one hash can ask for more than the whole book holds.
            payout_run("book_capital_insufficient", 5 * NEAR, 10 * NEAR, 8_000, &[(11 * NEAR, 0)]),
        ]
    }

    fn vectors() -> Value {
        json!({
            "about": "Generated by `ARUNA_WRITE_GOLDEN=1 cargo test -p aruna-pool golden` from the real pool. Amounts are yoctoNEAR strings.",
            "params": {
                "blocks_per_day": BLOCKS_PER_DAY, "k_x100": K_X100.to_string(), "concentration_bps": CONCENTRATION_BPS.to_string(),
                "risk_margin_bps": RISK_MARGIN_BPS, "capital_cost_bps_30d": CAPITAL_COST_BPS_30D,
                "p_event_bps_30d": { "immutable_verified": 50, "local_upgradeable": 500, "global_by_account": 1000 },
                "waiting_period_blocks": WAITING_PERIOD_BLOCKS, "claim_reporting_blocks": CLAIM_REPORTING_BLOCKS,
            },
            "quotes": quotes(),
            "purchase_runs": purchase_runs(),
            "payout_runs": payout_runs(),
        })
    }

    #[test]
    fn golden_vectors_match_the_pool() {
        let now = serde_json::to_string_pretty(&vectors()).unwrap() + "\n";
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(GOLDEN);
        if std::env::var("ARUNA_WRITE_GOLDEN").is_ok() {
            std::fs::write(&path, &now).unwrap();
            return;
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}. Run with ARUNA_WRITE_GOLDEN=1 to create it", path.display()));
        assert_eq!(committed, now, "the pool's answers differ from {GOLDEN}; if the rule change is deliberate, regenerate it and read the diff");
    }
}

// ---- golden events for packages/indexer ----
//
// The same idea as `golden` above, for the indexer: run a coverage story on the REAL pool (a deposit, a
// refused purchase, a purchase, a claim refused during the challenge window, a claim paid, expiry released,
// a withdrawal) and record every EVENT_JSON line with the block it was emitted at in
// fixtures/golden/events-pool.json. The indexer's tests replay it. Regenerate with
// `ARUNA_WRITE_GOLDEN=1 cargo test -p aruna-pool golden_events`, and read the diff.
mod golden_events {
    use super::*;
    use aruna_common::params::CLAIM_REPORTING_BLOCKS;
    use serde_json::Value;

    const GOLDEN: &str = "../../fixtures/golden/events-pool.json";

    /// Each `ctx` starts a fresh log, so call this once after the calls made under one `ctx`.
    fn capture(out: &mut Vec<Value>, block: u64) {
        for line in get_logs() {
            if let Some(body) = line.strip_prefix("EVENT_JSON:") {
                let v: Value = serde_json::from_str(body).unwrap();
                out.push(json!({ "block": block, "event": v["event"], "data": v["data"][0] }));
            }
        }
    }

    fn story() -> Vec<Value> {
        let mut out = vec![];
        let results = || purchase_results("client.testnet", "local_upgradeable", "H1", true, NEAR, "local_upgradeable", json!("near"), 0);
        let mut p = pool_with_capital(10 * NEAR);
        capture(&mut out, NOW);
        // A premium below the quote is refused, and says why.
        buy(&mut p, request("t.testnet", 10 * NEAR), TokenId::Near, 1, results());
        capture(&mut out, NOW);
        buy(&mut p, request("t.testnet", 10 * NEAR), TokenId::Near, NEAR, results());
        capture(&mut out, NOW);
        // A claim during the challenge window is refused; after it, a verified report pays.
        claim_on(&mut p, 0, vec![report("pending", "t.testnet", changed_of(0)), allowed()]);
        capture(&mut out, NOW + 500);
        claim_stage1(&mut p, vec![report("verified", "t.testnet", changed_of(0)), allowed()]);
        pay_stage(&mut p, 3 * NEAR, 0);
        capture(&mut out, NOW + 501);
        let after = NOW + BLOCKS_PER_DAY + CLAIM_REPORTING_BLOCKS + 1;
        ctx("anyone.testnet", after, 0, vec![]);
        p.release_expired(vec![0]);
        capture(&mut out, after);
        let shares = p.shares.get(&(acc("underwriter.testnet"), TokenId::Near)).copied().unwrap();
        ctx("underwriter.testnet", after, 1, vec![]);
        p.withdraw(TokenId::Near, U128(shares / 2));
        capture(&mut out, after);
        out
    }

    #[test]
    fn golden_events_match_the_pool() {
        let now = serde_json::to_string_pretty(&json!({
            "about": "Generated by `ARUNA_WRITE_GOLDEN=1 cargo test -p aruna-pool golden_events` from the real pool. One entry per EVENT_JSON line, with the block it was emitted at.",
            "events": story(),
        }))
        .unwrap()
            + "\n";
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(GOLDEN);
        if std::env::var("ARUNA_WRITE_GOLDEN").is_ok() {
            std::fs::write(&path, &now).unwrap();
            return;
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}. Run with ARUNA_WRITE_GOLDEN=1 to create it", path.display()));
        assert_eq!(committed, now, "the pool's events differ from {GOLDEN}; if the change is deliberate, regenerate it and read the diff");
    }
}
