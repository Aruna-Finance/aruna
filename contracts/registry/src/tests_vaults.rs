//! `vaults_by_code_hash` (plan U14, R35): which vaults run a code hash, and who registered them.
use crate::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn ctx(who: &str, height: u64) {
    testing_env!(VMContextBuilder::new().current_account_id(acc("registry.testnet")).predecessor_account_id(acc(who)).block_height(height).build());
}

/// Registers `(name, owner, hash)` in order, as the factory would.
fn registry_with(vaults: &[(&str, &str, &str)]) -> Registry {
    ctx("owner.testnet", 1);
    let mut r = Registry::new(acc("owner.testnet"));
    r.set_factory(acc("factory.testnet"));
    for (i, (name, owner, hash)) in vaults.iter().enumerate() {
        ctx("factory.testnet", 100 + i as u64);
        r.register_vault(acc(name), acc(owner), (*hash).into());
    }
    ctx("anyone.testnet", 1_000);
    r
}

fn names(p: &VaultPage) -> Vec<String> {
    p.items.iter().map(|v| v.vault.to_string()).collect()
}

#[test]
fn three_vaults_at_two_hashes_return_only_the_requested_hash_with_owners_and_blocks() {
    let r = registry_with(&[("a.factory.testnet", "alice.testnet", "H1"), ("b.factory.testnet", "bob.testnet", "H2"), ("c.factory.testnet", "carol.testnet", "H1")]);
    let page = r.vaults_by_code_hash("H1".into(), None, None);
    assert_eq!(names(&page), ["a.factory.testnet", "c.factory.testnet"]);
    assert_eq!(page.items.iter().map(|v| v.owner.to_string()).collect::<Vec<_>>(), ["alice.testnet", "carol.testnet"]);
    assert_eq!(page.items.iter().map(|v| v.registered_at_block).collect::<Vec<_>>(), [100, 102]);
    assert_eq!(page.next, None);
    assert_eq!(names(&r.vaults_by_code_hash("H2".into(), None, None)), ["b.factory.testnet"]);
}

#[test]
fn pagination_returns_every_match_exactly_once() {
    // Matches are spread so a page of 2 entries holds 0, 1 or 2 of them.
    let hashes = ["H1", "H2", "H2", "H1", "H1", "H2", "H1"];
    let list: Vec<(String, &str)> = hashes.iter().enumerate().map(|(i, h)| (format!("v{i}.factory.testnet"), *h)).collect();
    let r = registry_with(&list.iter().map(|(n, h)| (n.as_str(), "client.testnet", *h)).collect::<Vec<_>>());

    let mut seen = Vec::new();
    let mut from = Some(0);
    let mut calls = 0;
    while let Some(f) = from {
        let page = r.vaults_by_code_hash("H1".into(), Some(f), Some(2));
        seen.extend(names(&page));
        from = page.next;
        calls += 1;
        assert!(calls <= 4, "four windows of two cover seven entries");
    }
    assert_eq!(seen, ["v0.factory.testnet", "v3.factory.testnet", "v4.factory.testnet", "v6.factory.testnet"]);
}

#[test]
fn an_unknown_hash_returns_an_empty_page() {
    let r = registry_with(&[("a.factory.testnet", "alice.testnet", "H1")]);
    let page = r.vaults_by_code_hash("NOPE".into(), None, None);
    assert!(page.items.is_empty());
    assert_eq!(page.next, None);
}

#[test]
fn an_empty_registry_and_an_out_of_range_start_are_empty_not_errors() {
    let empty = registry_with(&[]);
    assert_eq!(empty.vaults_by_code_hash("H1".into(), None, None), VaultPage { items: vec![], next: None });
    let r = registry_with(&[("a.factory.testnet", "alice.testnet", "H1")]);
    assert_eq!(r.vaults_by_code_hash("H1".into(), Some(50), None), VaultPage { items: vec![], next: None });
}

#[test]
fn a_zero_limit_still_advances_and_a_huge_limit_is_bounded() {
    let n = MAX_VAULT_SCAN as usize + 5;
    let list: Vec<String> = (0..n).map(|i| format!("v{i}.factory.testnet")).collect();
    let r = registry_with(&list.iter().map(|v| (v.as_str(), "client.testnet", "H1")).collect::<Vec<_>>());

    let one = r.vaults_by_code_hash("H1".into(), Some(0), Some(0));
    assert_eq!((one.items.len(), one.next), (1, Some(1)), "limit 0 is treated as 1, so a caller following `next` cannot loop");

    let capped = r.vaults_by_code_hash("H1".into(), None, Some(u32::MAX));
    assert_eq!(capped.items.len(), MAX_VAULT_SCAN as usize);
    assert_eq!(capped.next, Some(MAX_VAULT_SCAN));
    assert_eq!(r.vaults_by_code_hash("H1".into(), capped.next, None).items.len(), 5);
}

#[test]
fn registering_the_same_vault_again_lists_it_once_with_the_latest_record() {
    let mut r = registry_with(&[("a.factory.testnet", "alice.testnet", "H1")]);
    ctx("factory.testnet", 500);
    r.register_vault(acc("a.factory.testnet"), acc("alice.testnet"), "H1".into());
    let page = r.vaults_by_code_hash("H1".into(), None, None);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].registered_at_block, 500);
}
