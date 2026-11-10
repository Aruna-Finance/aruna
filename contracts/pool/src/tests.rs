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
    p.cb_claim_pay(0, report_id)
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
