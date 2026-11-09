//! Owner and operator, every action in docs/CONTRACTS.md's table from each role.
use super::*;
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
fn ceiling() -> Ceiling {
    Ceiling {
        max_per_tx: U128(100),
        daily_total: U128(1_000),
        max_risk_class: RiskClass::GlobalByAccount,
        allowed_targets: vec![acc("swap.testnet"), acc("other.testnet")],
        agent_allowance: U128(250_000_000_000_000_000_000_000),
    }
}
fn policy(cap: u128) -> Policy {
    Policy {
        max_per_tx: U128(50),
        daily_cap: U128(cap),
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
    assert_eq!(v.get_agent(pk(1)).unwrap().policy.daily_cap, U128(900));
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
    v.withdraw_to_owner(U128(1));
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
    v.withdraw_to_owner(U128(5));
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
