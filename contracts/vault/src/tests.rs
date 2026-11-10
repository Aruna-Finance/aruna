//! Owner and operator, every action in docs/CONTRACTS.md's table from each role.
use super::*;
use aruna_common::{Reason, TokenId};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken};

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn pk(n: u8) -> PublicKey {
    let mut bytes = vec![0u8; 33];
    bytes[32] = n;
    PublicKey::try_from(bytes).unwrap()
}
fn as_caller(who: &str) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("vault.factory.testnet"))
        .predecessor_account_id(acc(who))
        .block_height(100)
        .attached_deposit(NearToken::from_yoctonear(1))
        .build());
}
fn usdc() -> TokenId {
    TokenId::Ft(acc("usdc.testnet"))
}
fn ceiling() -> Ceiling {
    Ceiling {
        tokens: vec![
            TokenCeiling { token: TokenId::Near, max_per_tx: U128(100), daily_total: U128(1_000) },
            TokenCeiling { token: usdc(), max_per_tx: U128(100), daily_total: U128(1_000) },
        ],
        max_risk_class: RiskClass::GlobalByAccount,
        allowed_targets: vec![acc("swap.testnet"), acc("other.testnet")],
        agent_allowance: U128(250_000_000_000_000_000_000_000),
    }
}
fn policy(cap: u128) -> Policy {
    Policy {
        limits: vec![TokenLimits { token: TokenId::Near, max_per_tx: U128(50), daily_cap: U128(cap) }],
        max_slippage_bps: 50,
        allowed_targets: vec![acc("swap.testnet")],
        max_risk_class: RiskClass::LocalUpgradeable,
    }
}
fn vault() -> Vault {
    as_caller("factory.testnet");
    Vault::new(acc("client.testnet"), Some(acc("company.testnet")), acc("registry.testnet"), ceiling())
}

#[test]
fn agent_methods_never_include_a_callback() {
    assert!(AGENT_METHODS.iter().all(|m| !m.starts_with("cb_")));
}

#[test]
fn operator_adds_an_agent_within_the_ceiling_and_the_key_carries_only_agent_methods() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "trader".into(), policy(400));
    let a = v.get_agent(pk(1)).unwrap();
    assert_eq!(a.status, AgentStatus::Active);
    let log = get_logs().into_iter().find(|l| l.contains("agent_registered")).unwrap();
    assert!(log.contains("\"methods\":\"spend,refresh_class\""));
}

#[test]
#[should_panic(expected = "ARUNA_OVER_CEILING")]
fn the_sum_of_daily_caps_cannot_exceed_the_ceiling() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(600));
    v.add_agent(pk(2), "b".into(), policy(500));
}

#[test]
fn a_revoked_agent_frees_its_share_of_the_ceiling() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(600));
    v.revoke_agent(pk(1));
    v.add_agent(pk(2), "b".into(), policy(600));
}

#[test]
#[should_panic(expected = "ARUNA_OVER_CEILING")]
fn a_target_outside_the_ceiling_is_refused() {
    let mut v = vault();
    as_caller("client.testnet");
    let mut p = policy(10);
    p.allowed_targets.push(acc("evil.testnet"));
    v.add_agent(pk(1), "a".into(), p);
}

#[test]
#[should_panic(expected = "ARUNA_OVER_CEILING")]
fn a_riskier_class_than_the_ceiling_is_refused() {
    let mut v = vault();
    as_caller("client.testnet");
    let mut p = policy(10);
    p.max_risk_class = RiskClass::Unknown;
    v.add_agent(pk(1), "a".into(), p);
}

#[test]
fn operator_can_pause_revoke_and_tighten() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    let mut tighter = policy(100);
    tighter.max_slippage_bps = 10;
    v.update_policy(pk(1), tighter.clone());
    assert_eq!(v.get_agent(pk(1)).unwrap().policy, tighter);
    v.pause_agent(pk(1));
    assert_eq!(v.get_agent(pk(1)).unwrap().status, AgentStatus::Paused);
    v.revoke_agent(pk(1));
    assert_eq!(v.get_agent(pk(1)).unwrap().status, AgentStatus::Revoked);
}

#[test]
#[should_panic(expected = "ARUNA_OPERATOR_CANNOT_LOOSEN")]
fn operator_cannot_raise_a_cap() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    v.update_policy(pk(1), policy(401));
}

#[test]
#[should_panic(expected = "ARUNA_OPERATOR_CANNOT_LOOSEN")]
fn operator_cannot_add_a_target() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    let mut p = policy(400);
    p.allowed_targets.push(acc("other.testnet"));
    v.update_policy(pk(1), p);
}

#[test]
#[should_panic(expected = "ARUNA_OPERATOR_CANNOT_LOOSEN")]
fn operator_cannot_allow_a_riskier_class() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    let mut p = policy(400);
    p.max_risk_class = RiskClass::GlobalByAccount;
    v.update_policy(pk(1), p);
}

#[test]
fn owner_can_loosen_within_the_ceiling() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    as_caller("client.testnet");
    v.update_policy(pk(1), policy(900));
    assert_eq!(v.get_agent(pk(1)).unwrap().policy.limits[0].daily_cap, U128(900));
}

#[test]
#[should_panic(expected = "ARUNA_OPERATOR_CANNOT_RESUME")]
fn operator_cannot_resume_a_paused_agent() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    v.pause_agent(pk(1));
    v.resume_agent(pk(1));
}

#[test]
fn owner_resumes_a_paused_agent() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    v.pause_agent(pk(1));
    as_caller("client.testnet");
    v.resume_agent(pk(1));
    assert_eq!(v.get_agent(pk(1)).unwrap().status, AgentStatus::Active);
}

#[test]
#[should_panic(expected = "ARUNA_AGENT_REVOKED")]
fn a_revoked_agent_cannot_be_resumed() {
    let mut v = vault();
    as_caller("client.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    v.revoke_agent(pk(1));
    v.resume_agent(pk(1));
}

#[test]
#[should_panic(expected = "ARUNA_NOT_OWNER")]
fn operator_cannot_withdraw() {
    let mut v = vault();
    as_caller("company.testnet");
    v.withdraw_to_owner(U128(1), None);
}

#[test]
#[should_panic(expected = "ARUNA_NOT_OWNER")]
fn operator_cannot_change_the_owner() {
    let mut v = vault();
    as_caller("company.testnet");
    v.set_owner(acc("company.testnet"));
}

#[test]
#[should_panic(expected = "ARUNA_NOT_OWNER")]
fn operator_cannot_remove_itself_or_set_another_operator() {
    let mut v = vault();
    as_caller("company.testnet");
    v.set_operator(Some(acc("friend.testnet")));
}

#[test]
#[should_panic(expected = "ARUNA_NOT_OWNER")]
fn operator_cannot_raise_the_ceiling() {
    let mut v = vault();
    as_caller("company.testnet");
    v.set_ceiling(ceiling());
}

#[test]
#[should_panic(expected = "ARUNA_NOT_OWNER_OR_OPERATOR")]
fn a_removed_operator_loses_every_right() {
    let mut v = vault();
    as_caller("client.testnet");
    v.set_operator(None);
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(1));
}

#[test]
#[should_panic(expected = "ARUNA_NOT_OWNER_OR_OPERATOR")]
fn a_stranger_cannot_add_an_agent() {
    let mut v = vault();
    as_caller("stranger.testnet");
    v.add_agent(pk(1), "a".into(), policy(1));
}

#[test]
fn owner_withdraws_and_changes_owner() {
    let mut v = vault();
    as_caller("client.testnet");
    v.withdraw_to_owner(U128(5), None);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"withdrawal\"")));
    v.set_owner(acc("client2.testnet"));
    assert_eq!(v.get_config().owner, acc("client2.testnet"));
}

fn as_caller_with_key_only(who: &str) {
    // A function-call key cannot attach a deposit: model it as a call with none.
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("vault.factory.testnet"))
        .predecessor_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(0))
        .build());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn a_function_call_key_of_the_owner_cannot_change_the_owner() {
    let mut v = vault();
    as_caller_with_key_only("client.testnet");
    v.set_owner(acc("thief.testnet"));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn a_function_call_key_of_the_operator_cannot_add_an_agent() {
    let mut v = vault();
    as_caller_with_key_only("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(1));
}

#[test]
fn a_function_call_key_can_still_pause_and_revoke() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(1));
    as_caller_with_key_only("company.testnet");
    v.pause_agent(pk(1));
    v.revoke_agent(pk(1));
}

#[test]
#[should_panic(expected = "ARUNA_TOO_MANY_AGENTS")]
fn the_operator_cannot_add_agents_without_bound() {
    let mut v = vault();
    as_caller("company.testnet");
    for i in 0..=aruna_common::MAX_AGENTS {
        v.add_agent(pk(i as u8 + 1), "zero-cap".into(), policy(0));
    }
}

#[test]
#[should_panic(expected = "ARUNA_TARGET_NOT_IN_CEILING")]
fn nobody_can_grow_the_class_cache_with_arbitrary_targets() {
    let mut v = vault();
    as_caller("stranger.testnet");
    v.refresh_class(acc("anything.testnet"));
}

// ---- v3: tokens, exposure history, policy history, freeze (plan U3) ----

use near_sdk::PromiseResult;

fn as_agent(n: u8, height: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("vault.factory.testnet"))
        .predecessor_account_id(acc("vault.factory.testnet"))
        .signer_account_pk(pk(n))
        .block_height(height)
        .account_balance(NearToken::from_near(10))
        .build());
}
fn as_callback(height: u64, result: PromiseResult) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acc("vault.factory.testnet"))
            .predecessor_account_id(acc("vault.factory.testnet"))
            .block_height(height)
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}
fn usdc_policy(cap: u128) -> Policy {
    Policy {
        limits: vec![TokenLimits { token: usdc(), max_per_tx: U128(50), daily_cap: U128(cap) }],
        max_slippage_bps: 50,
        allowed_targets: vec![acc("swap.testnet")],
        max_risk_class: RiskClass::LocalUpgradeable,
    }
}
fn with_cached_swap(v: &mut Vault, height: u64) {
    v.classes.insert(acc("swap.testnet"), CachedClass { class: RiskClass::LocalUpgradeable, frozen: false, classified_at_block: height, fetched_at_block: height });
}
fn last_reason() -> Option<String> {
    get_logs().iter().rev().find(|l| l.contains("execution_rejected")).map(|l| {
        let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(l.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
        v["data"][0]["reason"].as_str().unwrap().to_string()
    })
}

#[test]
fn a_usdc_spend_is_checked_against_usdc_limits_only() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), usdc_policy(100));
    with_cached_swap(&mut v, 100);
    as_agent(1, 101);
    v.spend("ft_swap".into(), acc("swap.testnet"), U128(40), U128(40), Some(acc("usdc.testnet")));
    assert!(get_logs().iter().any(|l| l.contains("execution_allowed")), "{:?}", get_logs());
    assert_eq!(last_reason(), None);
    // The same agent has no NEAR limits at all.
    v.spend("swap".into(), acc("swap.testnet"), U128(1), U128(1), None);
    assert_eq!(last_reason().as_deref(), Some("ARUNA_MAX_PER_TX_EXCEEDED"));
}

#[test]
fn a_usdc_spend_over_the_usdc_daily_cap_is_refused_and_counted() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), usdc_policy(30));
    with_cached_swap(&mut v, 100);
    as_agent(1, 101);
    v.spend("ft_swap".into(), acc("swap.testnet"), U128(40), U128(40), Some(acc("usdc.testnet")));
    assert_eq!(last_reason().as_deref(), Some("ARUNA_DAILY_CAP_EXCEEDED"));
    assert_eq!(v.get_agent(pk(1)).unwrap().refusals.len(), 1);
}

#[test]
#[should_panic(expected = "ARUNA_ADAPTER_TOKEN_MISMATCH")]
fn ft_swap_needs_a_token() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), usdc_policy(30));
    as_agent(1, 101);
    v.spend("ft_swap".into(), acc("swap.testnet"), U128(1), U128(1), None);
}

#[test]
fn ft_on_transfer_takes_only_listed_tokens() {
    let mut v = vault();
    as_caller("usdc.testnet");
    assert_eq!(v.ft_on_transfer(acc("anyone.testnet"), U128(7), "".into()), U128(0));
    as_caller("scam.testnet");
    assert_eq!(v.ft_on_transfer(acc("anyone.testnet"), U128(7), "".into()), U128(7));
}

fn reserve_usdc(v: &mut Vault, amount: u128) {
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), usdc_policy(100));
    with_cached_swap(v, 100);
    as_agent(1, 101);
    v.spend("ft_swap".into(), acc("swap.testnet"), U128(amount), U128(amount), Some(acc("usdc.testnet")));
}

#[test]
fn a_token_spend_the_target_partly_used_settles_that_part_and_releases_the_rest() {
    let mut v = vault();
    reserve_usdc(&mut v, 40);
    as_callback(102, PromiseResult::Successful(b"\"25\"".to_vec()));
    assert!(v.cb_settle(pk(1), acc("swap.testnet"), U128(40), RiskClass::LocalUpgradeable, Some(usdc())));
    let b = v.get_agent(pk(1)).unwrap().budgets.into_iter().find(|b| b.token == usdc()).unwrap();
    assert_eq!((b.spent_today, b.reserved), (U128(25), U128(0)));
    assert_eq!(v.get_exposure(acc("swap.testnet"), Some(usdc())).unwrap().amount, U128(25));
    assert_eq!(v.get_exposure(acc("swap.testnet"), None), None);
}

#[test]
fn a_failed_token_spend_releases_the_reservation_and_records_nothing() {
    let mut v = vault();
    reserve_usdc(&mut v, 40);
    as_callback(102, PromiseResult::Failed);
    assert!(!v.cb_settle(pk(1), acc("swap.testnet"), U128(40), RiskClass::LocalUpgradeable, Some(usdc())));
    let b = v.get_agent(pk(1)).unwrap().budgets.into_iter().find(|b| b.token == usdc()).unwrap();
    assert_eq!((b.spent_today, b.reserved), (U128(0), U128(0)));
    assert_eq!(v.get_exposure(acc("swap.testnet"), Some(usdc())), None);
}

#[test]
fn exposure_before_a_block_reads_the_checkpoints() {
    // Covers AE6 (vault side): 3 at block 10, 2 more at block 20.
    let mut v = vault_at(10);
    v.record_exposure(&pk(1), &acc("swap.testnet"), &TokenId::Near, 3, RiskClass::LocalUpgradeable);
    testing_env!(VMContextBuilder::new().current_account_id(acc("vault.factory.testnet")).block_height(20).build());
    v.record_exposure(&pk(1), &acc("swap.testnet"), &TokenId::Near, 2, RiskClass::LocalUpgradeable);
    let before = |b| v.exposure_before(pk(1), acc("swap.testnet"), TokenId::Near, b).0;
    assert_eq!((before(5), before(10), before(15), before(25)), (0, 0, 3, 5));
    assert_eq!(v.exposure_before(pk(2), acc("swap.testnet"), TokenId::Near, 25), U128(0));
}

fn vault_at(height: u64) -> Vault {
    testing_env!(VMContextBuilder::new().current_account_id(acc("vault.factory.testnet")).predecessor_account_id(acc("factory.testnet")).block_height(height).build());
    Vault::new(acc("client.testnet"), Some(acc("company.testnet")), acc("registry.testnet"), ceiling())
}

#[test]
fn raising_a_cap_records_a_loosening_and_lowering_it_only_bumps_the_version() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    assert_eq!(v.get_agent(pk(1)).unwrap().policy_version, 1);
    as_caller("company.testnet");
    v.update_policy(pk(1), policy(300));
    let a = v.get_agent(pk(1)).unwrap();
    assert_eq!((a.policy_version, a.last_loosened_at), (2, 0));
    as_caller("client.testnet");
    v.update_policy(pk(1), policy(900));
    let a = v.get_agent(pk(1)).unwrap();
    assert_eq!((a.policy_version, a.last_loosened_at), (3, 100));
}

#[test]
fn adding_a_token_to_a_policy_is_a_loosening() {
    let mut p = policy(400);
    assert!(!agents::loosens(&p, &p.clone()));
    let prev = p.clone();
    p.limits.push(TokenLimits { token: usdc(), max_per_tx: U128(1), daily_cap: U128(1) });
    assert!(agents::loosens(&prev, &p));
}

#[test]
#[should_panic(expected = "ARUNA_NOT_REGISTRY")]
fn only_the_registry_freezes() {
    let mut v = vault();
    as_caller("company.testnet");
    v.freeze_target(acc("swap.testnet"));
}

#[test]
fn a_registry_freeze_refuses_the_next_spend() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), policy(400));
    with_cached_swap(&mut v, 100);
    as_caller("registry.testnet");
    assert!(v.freeze_target(acc("swap.testnet")));
    assert!(!v.freeze_target(acc("elsewhere.testnet")));
    as_agent(1, 101);
    v.spend("swap".into(), acc("swap.testnet"), U128(10), U128(10), None);
    assert_eq!(last_reason().as_deref(), Some("ARUNA_TARGET_FROZEN"));
}

#[test]
#[should_panic(expected = "ARUNA_NOT_OWNER")]
fn the_operator_cannot_withdraw_tokens() {
    let mut v = vault();
    as_caller("company.testnet");
    v.withdraw_to_owner(U128(1), Some(usdc()));
}

#[test]
fn the_owner_withdraws_tokens_to_themselves() {
    let mut v = vault();
    as_caller("client.testnet");
    v.withdraw_to_owner(U128(5), Some(usdc()));
    assert!(get_logs().iter().any(|l| l.contains("\"withdrawal\"") && l.contains("client.testnet") && l.contains("usdc.testnet")));
}

// ---- v4: simulate (docs/MCP.md aruna_simulate, docs/SDK.md vault.simulate) ----

#[test]
fn simulate_allows_what_spend_allows_without_reserving_anything() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), usdc_policy(100));
    with_cached_swap(&mut v, 100);
    as_agent(1, 101);
    let sim = v.simulate(pk(1), "ft_swap".into(), acc("swap.testnet"), U128(40), U128(40), Some(acc("usdc.testnet")));
    assert_eq!(sim, Simulation { verdict: "allow".into(), reason: None, class: Some(RiskClass::LocalUpgradeable) });
    assert!(v.get_agent(pk(1)).unwrap().budgets.is_empty(), "nothing reserved");
    v.spend("ft_swap".into(), acc("swap.testnet"), U128(40), U128(40), Some(acc("usdc.testnet")));
    assert!(get_logs().iter().any(|l| l.contains("execution_allowed")));
}

#[test]
fn simulate_blocks_with_the_reason_spend_would_return_and_counts_nothing() {
    let mut v = vault();
    as_caller("company.testnet");
    v.add_agent(pk(1), "a".into(), usdc_policy(30));
    with_cached_swap(&mut v, 100);
    as_agent(1, 101);
    let sim = v.simulate(pk(1), "ft_swap".into(), acc("swap.testnet"), U128(40), U128(40), Some(acc("usdc.testnet")));
    assert_eq!((sim.verdict.as_str(), sim.reason), ("block", Some(Reason::DailyCapExceeded)));
    assert!(v.get_agent(pk(1)).unwrap().refusals.is_empty(), "a simulation is not a refusal");
    v.spend("ft_swap".into(), acc("swap.testnet"), U128(40), U128(40), Some(acc("usdc.testnet")));
    assert_eq!(last_reason().as_deref(), Some("ARUNA_DAILY_CAP_EXCEEDED"), "spend agrees");
    for (target, reason) in [("elsewhere.testnet", Reason::TargetNotAllowed)] {
        let sim = v.simulate(pk(1), "swap".into(), acc(target), U128(1), U128(1), None);
        assert_eq!(sim.reason, Some(reason));
    }
}

#[test]
#[should_panic(expected = "ARUNA_UNKNOWN_AGENT")]
fn simulate_for_an_unknown_key_panics_like_spend() {
    let v = vault();
    v.simulate(pk(9), "swap".into(), acc("swap.testnet"), U128(1), U128(1), None);
}
