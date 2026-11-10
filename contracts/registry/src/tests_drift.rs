//! The drift path (plan U4). Reports are signed with ed25519-dalek over `DriftReport::signing_bytes`,
//! and one test files the shared golden vector from fixtures/golden/drift-report.json.
use crate::*;
use aruna_common::params::{ATTESTOR_MIN_BOND, CHALLENGE_WINDOW_BLOCKS, HEARTBEAT_STALE_BLOCKS, MAX_LOOKBACK_BLOCKS};
use aruna_common::{CodeRef, DriftChannel, DriftReport, ReportState};
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::Base64VecU8;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken, PublicKey};

const A: &str = "attestor-a.arunafi.testnet";
const B: &str = "attestor-b.arunafi.testnet";
const T: &str = "fx-guser.arunafi.testnet";
const NOW: u64 = 277_000_200;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn ctx(who: &str, height: u64, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("registry.testnet"))
        .predecessor_account_id(acc(who))
        .block_height(height)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .build());
}
fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}
fn pk(seed: u8) -> PublicKey {
    format!("ed25519:{}", bs58::encode(key(seed).verifying_key().to_bytes()).into_string()).parse().unwrap()
}
fn report(attestor: &str, changed: u64, nonce: u64, after: &str) -> DriftReport {
    DriftReport {
        target: acc(T),
        observed_at_block: NOW - 10,
        changed_at_block: changed,
        before_ref: CodeRef::GlobalAccount { owner_account: acc("fx-gowner.arunafi.testnet") },
        after_ref: CodeRef::GlobalAccount { owner_account: acc("fx-gowner.arunafi.testnet") },
        before_resolved_hash: "BEFORE".into(),
        after_resolved_hash: after.into(),
        channel: DriftChannel::DeployGlobalContract,
        attestor: acc(attestor),
        nonce,
        expires_at: NOW + 600,
    }
}
fn sig(r: &DriftReport, seed: u8) -> Base64VecU8 {
    Base64VecU8(key(seed).sign(&r.signing_bytes()).to_bytes().to_vec())
}
fn setup() -> Registry {
    ctx("owner.testnet", NOW - 50, 0);
    let mut r = Registry::new(acc("owner.testnet"));
    r.set_pool(acc("pool.testnet"));
    ctx(A, NOW - 50, ATTESTOR_MIN_BOND);
    r.register_attestor(pk(1));
    ctx(B, NOW - 50, ATTESTOR_MIN_BOND);
    r.register_attestor(pk(2));
    ctx("owner.testnet", NOW - 50, 0);
    r.assign_attestor(acc(T), acc(A));
    r
}
fn file(r: &mut Registry, rep: &DriftReport, seed: u8) -> u32 {
    ctx(rep.attestor.as_str(), NOW, 0);
    r.report_drift(rep.clone(), sig(rep, seed))
}

#[test]
fn the_golden_vector_is_accepted() {
    let g: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(include_str!("../../../fixtures/golden/drift-report.json")).unwrap();
    let rep: DriftReport = near_sdk::serde_json::from_value(g["report"].clone()).unwrap();
    let unhex = |s: &str| (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect::<Vec<u8>>();
    ctx("owner.testnet", NOW - 50, 0);
    let mut r = Registry::new(acc("owner.testnet"));
    let golden_pk: PublicKey = format!("ed25519:{}", bs58::encode(unhex(g["public_key_hex"].as_str().unwrap())).into_string()).parse().unwrap();
    assert_eq!(golden_pk, pk(1), "the golden seed is 32 bytes of 0x01");
    ctx(A, NOW - 50, ATTESTOR_MIN_BOND);
    r.register_attestor(golden_pk);
    ctx(A, NOW, 0);
    let id = r.report_drift(rep, Base64VecU8(unhex(g["signature_hex"].as_str().unwrap())));
    assert_eq!(r.get_report(id).unwrap().state, ReportState::Pending);
}

#[test]
fn an_accepted_report_freezes_the_target() {
    let mut r = setup();
    let id = file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    assert!(r.get_class(acc(T)).unwrap().frozen);
    assert!(get_logs().iter().any(|l| l.contains("\"drift_reported\"")));
    assert_eq!(r.latest_report(acc(T)).unwrap().id, id);
}

#[test]
#[should_panic(expected = "ARUNA_HASHES_MATCH")]
fn identical_resolved_hashes_are_rejected() {
    // Covers AE4.
    let mut r = setup();
    file(&mut r, &report(A, NOW - 100, 1, "BEFORE"), 1);
}

#[test]
#[should_panic(expected = "ARUNA_OUTSIDE_LOOKBACK")]
fn a_change_older_than_the_lookback_is_rejected() {
    let mut r = setup();
    file(&mut r, &report(A, NOW - MAX_LOOKBACK_BLOCKS - 1, 1, "AFTER"), 1);
}

#[test]
fn a_change_exactly_at_the_lookback_bound_is_accepted() {
    let mut r = setup();
    let mut rep = report(A, NOW - MAX_LOOKBACK_BLOCKS, 1, "AFTER");
    rep.observed_at_block = NOW - MAX_LOOKBACK_BLOCKS;
    file(&mut r, &rep, 1);
}

#[test]
#[should_panic(expected = "ARUNA_BAD_SIGNATURE")]
fn a_forged_signature_is_rejected() {
    let mut r = setup();
    file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 9);
}

#[test]
#[should_panic(expected = "ARUNA_BAD_SIGNATURE")]
fn a_signature_over_different_fields_is_rejected() {
    let mut r = setup();
    let signed = report(A, NOW - 100, 1, "AFTER");
    let mut swapped = signed.clone();
    swapped.changed_at_block -= 1;
    ctx(A, NOW, 0);
    r.report_drift(swapped, sig(&signed, 1));
}

#[test]
#[should_panic(expected = "ARUNA_REPORT_EXPIRED")]
fn an_expired_report_is_rejected() {
    let mut r = setup();
    let rep = report(A, NOW - 100, 1, "AFTER");
    ctx(A, rep.expires_at + 1, 0);
    r.report_drift(rep.clone(), sig(&rep, 1));
}

#[test]
#[should_panic(expected = "ARUNA_NONCE_REUSED")]
fn a_replayed_nonce_is_rejected() {
    let mut r = setup();
    let first = report(A, NOW - 100, 1, "AFTER");
    file(&mut r, &first, 1);
    ctx(A, NOW + CHALLENGE_WINDOW_BLOCKS, 0);
    r.report_drift(first.clone(), sig(&first, 1));
}

#[test]
#[should_panic(expected = "ARUNA_UNKNOWN_ATTESTOR")]
fn an_account_without_a_bond_cannot_report() {
    let mut r = setup();
    file(&mut r, &report("stranger.testnet", NOW - 100, 1, "AFTER"), 1);
}

#[test]
#[should_panic(expected = "ARUNA_BOND_TOO_SMALL")]
fn registering_needs_the_minimum_bond() {
    let mut r = setup();
    ctx("cheap.testnet", NOW, ATTESTOR_MIN_BOND - 1);
    r.register_attestor(pk(3));
}

#[test]
fn the_state_reads_verified_once_the_window_closes() {
    let mut r = setup();
    let id = file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    ctx("anyone.testnet", NOW + CHALLENGE_WINDOW_BLOCKS - 1, 0);
    assert_eq!(r.get_report(id).unwrap().state, ReportState::Pending);
    ctx("anyone.testnet", NOW + CHALLENGE_WINDOW_BLOCKS, 0);
    assert_eq!(r.get_report(id).unwrap().state, ReportState::Verified);
}

#[test]
fn a_conflicting_report_from_the_other_attestor_disputes_the_first() {
    let mut r = setup();
    let first = file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    let second = file(&mut r, &report(B, NOW - 40, 1, "AFTER"), 2);
    assert_eq!(r.get_report(first).unwrap().state, ReportState::Disputed);
    assert_eq!(r.get_report(first).unwrap().disputed_by, Some(second));
    ctx("anyone.testnet", NOW + 10 * CHALLENGE_WINDOW_BLOCKS, 0);
    assert_eq!(r.get_report(first).unwrap().state, ReportState::Disputed, "a dispute does not expire into Verified");
}

#[test]
fn an_agreeing_report_from_the_other_attestor_does_not_dispute() {
    let mut r = setup();
    let first = file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    file(&mut r, &report(B, NOW - 100, 1, "AFTER"), 2);
    assert_eq!(r.get_report(first).unwrap().state, ReportState::Pending);
}

#[test]
#[should_panic(expected = "ARUNA_REPORT_ALREADY_OPEN")]
fn the_same_attestor_cannot_dispute_itself() {
    let mut r = setup();
    file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    file(&mut r, &report(A, NOW - 40, 2, "AFTER"), 1);
}

#[test]
fn the_arbiter_upholding_verifies_the_report() {
    let mut r = setup();
    let first = file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    file(&mut r, &report(B, NOW - 40, 1, "AFTER"), 2);
    ctx("owner.testnet", NOW + 1, 0);
    r.rule(first, true);
    assert_eq!(r.get_report(first).unwrap().state, ReportState::Verified);
    assert!(r.get_class(acc(T)).unwrap().frozen);
}

#[test]
fn the_arbiter_rejecting_slashes_the_bond_and_unfreezes() {
    let mut r = setup();
    let first = file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    file(&mut r, &report(B, NOW - 40, 1, "AFTER"), 2);
    ctx("owner.testnet", NOW + 1, 0);
    r.rule(first, false);
    assert_eq!(r.get_report(first).unwrap().state, ReportState::Rejected);
    assert_eq!(r.get_attestor(acc(A)).unwrap().bond.0, 0);
    assert!(!r.get_class(acc(T)).unwrap().frozen);
    assert!(get_logs().iter().any(|l| l.contains("\"slashed\"")));
}

#[test]
#[should_panic(expected = "ARUNA_NO_BOND")]
fn a_slashed_attestor_cannot_report_again() {
    let mut r = the_slashed_registry();
    file(&mut r, &report(A, NOW - 5, 9, "AFTER2"), 1);
}

fn the_slashed_registry() -> Registry {
    let mut r = setup();
    let first = file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    file(&mut r, &report(B, NOW - 40, 1, "AFTER"), 2);
    ctx("owner.testnet", NOW + 1, 0);
    r.rule(first, false);
    r
}

#[test]
#[should_panic(expected = "ARUNA_NOT_ARBITER")]
fn only_the_arbiter_rules() {
    let mut r = setup();
    let first = file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    file(&mut r, &report(B, NOW - 40, 1, "AFTER"), 2);
    ctx(B, NOW + 1, 0);
    r.rule(first, false);
}

#[test]
fn a_freeze_batch_reaches_only_its_slice() {
    let mut r = setup();
    ctx("owner.testnet", NOW - 40, 0);
    r.set_factory(acc("factory.testnet"));
    ctx("factory.testnet", NOW - 40, 0);
    for i in 0..5 {
        r.register_vault(acc(&format!("v{i}.factory.testnet")), acc("client.testnet"), "CODE".into());
    }
    file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    ctx("anyone.testnet", NOW + 1, 0);
    assert_eq!(r.push_freeze(acc(T), 1, 2), 2);
    assert!(get_logs().iter().any(|l| l.contains("\"freeze_pushed\"") && l.contains("\"from\":1") && l.contains("\"to\":3")));
    assert_eq!(r.push_freeze(acc(T), 4, 10), 1);
}

#[test]
fn heartbeats_go_stale() {
    // Covers AE8 (registry side).
    let mut r = setup();
    ctx(A, NOW, 0);
    r.heartbeat();
    ctx("anyone.testnet", NOW + HEARTBEAT_STALE_BLOCKS, 0);
    assert!(r.heartbeat_fresh(acc(T)));
    ctx("anyone.testnet", NOW + HEARTBEAT_STALE_BLOCKS + 1, 0);
    assert!(!r.heartbeat_fresh(acc(T)));
    assert!(!r.heartbeat_fresh(acc("unassigned.testnet")));
}

#[test]
fn only_allowed_vault_code_hashes_are_returned_for_coverage() {
    let mut r = setup();
    ctx("owner.testnet", NOW, 0);
    r.set_factory(acc("factory.testnet"));
    ctx("factory.testnet", NOW, 0);
    r.register_vault(acc("v.factory.testnet"), acc("client.testnet"), "V3".into());
    assert!(r.get_allowed_vault(acc("v.factory.testnet")).is_none());
    ctx("owner.testnet", NOW, 0);
    r.allow_vault_code_hash("V3".into(), true);
    assert!(r.get_allowed_vault(acc("v.factory.testnet")).is_some());
}

#[test]
#[should_panic(expected = "ARUNA_REPORT_NOT_FINAL")]
fn a_freeze_cannot_be_lifted_while_the_report_is_pending() {
    let mut r = setup();
    file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    ctx("owner.testnet", NOW + 1, 0);
    r.lift_freeze(acc(T));
}

#[test]
fn the_owner_lifts_a_freeze_once_the_report_is_verified() {
    let mut r = setup();
    let id = file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    ctx("owner.testnet", NOW + CHALLENGE_WINDOW_BLOCKS, 0);
    r.lift_freeze(acc(T));
    assert!(!r.get_class(acc(T)).unwrap().frozen);
    assert_eq!(r.get_report(id).unwrap().state, ReportState::Verified, "the report, which claims read, is untouched");
}

#[test]
#[should_panic(expected = "ARUNA_NOT_OWNER")]
fn only_the_owner_lifts_a_freeze() {
    let mut r = setup();
    file(&mut r, &report(A, NOW - 100, 1, "AFTER"), 1);
    ctx(A, NOW + CHALLENGE_WINDOW_BLOCKS, 0);
    r.lift_freeze(acc(T));
}
