//! registry — shared source of truth for what class a target is (docs/CONTRACTS.md).
//! v0 scope: the authorized classifier set, class records, and vault version records written by the
//! factory. Drift reports, bonds, challenge windows and freeze push arrive with the attestor (Stage 7).

use aruna_common::reasons::panics;
use aruna_common::{emit, RiskClass};
use near_sdk::serde_json::json;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ClassRecord {
    pub class: RiskClass,
    /// Hash of the classifier's evidence JSON, so anyone can check a record against a re-run.
    pub evidence_hash: String,
    pub classified_at_block: u64,
    pub classifier: AccountId,
    /// Set by the drift path (Stage 7). Always false in v0.
    pub frozen: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VaultRecord {
    pub vault: AccountId,
    pub owner: AccountId,
    /// Global contract hash the vault runs; maps a security finding to affected vaults.
    pub code_hash: String,
    pub registered_at_block: u64,
}

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Classifiers,
    Classes,
    Vaults,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    owner: AccountId,
    factory: Option<AccountId>,
    classifiers: IterableSet<AccountId>,
    classes: LookupMap<AccountId, ClassRecord>,
    vaults: LookupMap<AccountId, VaultRecord>,
}

#[near]
impl Registry {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            factory: None,
            classifiers: IterableSet::new(Key::Classifiers),
            classes: LookupMap::new(Key::Classes),
            vaults: LookupMap::new(Key::Vaults),
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, panics::NOT_OWNER);
    }

    // ---- owner ----

    pub fn add_classifier(&mut self, account: AccountId) {
        self.assert_owner();
        self.classifiers.insert(account.clone());
        emit("classifier_added", json!({ "account": account }));
    }

    pub fn remove_classifier(&mut self, account: AccountId) {
        self.assert_owner();
        self.classifiers.remove(&account);
        emit("classifier_removed", json!({ "account": account }));
    }

    pub fn set_factory(&mut self, factory: AccountId) {
        self.assert_owner();
        self.factory = Some(factory.clone());
        emit("factory_set", json!({ "factory": factory }));
    }

    // ---- authorized classifiers only (docs/DECISIONS.md D-12) ----

    pub fn set_class(&mut self, target: AccountId, class: RiskClass, evidence_hash: String) {
        let classifier = env::predecessor_account_id();
        require!(self.classifiers.contains(&classifier), panics::NOT_CLASSIFIER);
        let frozen = self.classes.get(&target).is_some_and(|r| r.frozen);
        let record = ClassRecord { class, evidence_hash, classified_at_block: env::block_height(), classifier, frozen };
        emit("target_classified", json!({ "target": target, "record": record }));
        self.classes.insert(target, record);
    }

    // ---- factory only ----

    pub fn register_vault(&mut self, vault: AccountId, owner: AccountId, code_hash: String) {
        require!(Some(env::predecessor_account_id()) == self.factory, panics::NOT_FACTORY);
        let record = VaultRecord { vault: vault.clone(), owner, code_hash, registered_at_block: env::block_height() };
        emit("vault_deployed", json!(record));
        self.vaults.insert(vault, record);
    }

    // ---- views ----

    pub fn get_class(&self, target: AccountId) -> Option<ClassRecord> {
        self.classes.get(&target).cloned()
    }

    pub fn get_vault(&self, vault: AccountId) -> Option<VaultRecord> {
        self.vaults.get(&vault).cloned()
    }

    pub fn is_classifier(&self, account: AccountId) -> bool {
        self.classifiers.contains(&account)
    }

    pub fn classifiers(&self) -> Vec<AccountId> {
        self.classifiers.iter().cloned().collect()
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn factory(&self) -> Option<AccountId> {
        self.factory.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn as_caller(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(acc(who)).block_height(42).build());
    }
    fn registry() -> Registry {
        as_caller("owner.near");
        let mut r = Registry::new(acc("owner.near"));
        r.add_classifier(acc("classifier.near"));
        r.set_factory(acc("factory.near"));
        r
    }

    #[test]
    fn authorized_classifier_writes_a_class_and_emits() {
        let mut r = registry();
        as_caller("classifier.near");
        r.set_class(acc("t.near"), RiskClass::GlobalByAccount, "H".into());
        let rec = r.get_class(acc("t.near")).unwrap();
        assert_eq!(rec.class, RiskClass::GlobalByAccount);
        assert_eq!(rec.classified_at_block, 42);
        assert_eq!(rec.classifier, acc("classifier.near"));
        assert!(get_logs().iter().any(|l| l.contains("\"event\":\"target_classified\"")));
    }

    #[test]
    #[should_panic(expected = "ARUNA_NOT_AUTHORIZED_CLASSIFIER")]
    fn anyone_else_cannot_write_a_class() {
        let mut r = registry();
        as_caller("attacker.near");
        r.set_class(acc("t.near"), RiskClass::ImmutableVerified, "H".into());
    }

    #[test]
    #[should_panic(expected = "ARUNA_NOT_AUTHORIZED_CLASSIFIER")]
    fn a_removed_classifier_cannot_write() {
        let mut r = registry();
        r.remove_classifier(acc("classifier.near"));
        as_caller("classifier.near");
        r.set_class(acc("t.near"), RiskClass::Unknown, "H".into());
    }

    #[test]
    #[should_panic(expected = "ARUNA_NOT_OWNER")]
    fn only_the_owner_manages_classifiers() {
        let mut r = registry();
        as_caller("classifier.near");
        r.add_classifier(acc("friend.near"));
    }

    #[test]
    fn the_factory_registers_a_vault_with_its_code_hash() {
        let mut r = registry();
        as_caller("factory.near");
        r.register_vault(acc("v.factory.near"), acc("client.near"), "CODE".into());
        assert_eq!(r.get_vault(acc("v.factory.near")).unwrap().code_hash, "CODE");
    }

    #[test]
    #[should_panic(expected = "ARUNA_NOT_FACTORY")]
    fn nobody_else_registers_a_vault() {
        let mut r = registry();
        as_caller("owner.near");
        r.register_vault(acc("v.near"), acc("client.near"), "CODE".into());
    }
}
