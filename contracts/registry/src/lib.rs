//! registry — shared source of truth for what class a target is and whether it is frozen
//! (docs/CONTRACTS.md). Holds the authorized classifier set, class records, vault records and the
//! vault code hashes allowed for coverage, and the drift path (plan U4): bonded attestors with
//! signing keys and heartbeats, signed drift reports, freezes pushed to vaults, disputes and the
//! arbiter's rulings. TWO TRUST ASSUMPTIONS: the attestor and the arbiter (docs/DECISIONS.md D-22).

mod attestors;
mod drift;

pub use attestors::Attestor;
pub use drift::StoredReport;

use aruna_common::reasons::panics;
use aruna_common::{emit, RiskClass};
use near_sdk::serde_json::json;
use near_sdk::store::{IterableSet, LookupMap, LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ClassRecord {
    pub class: RiskClass,
    /// Hash of the classifier's evidence JSON, so anyone can check a record against a re-run.
    pub evidence_hash: String,
    pub classified_at_block: u64,
    pub classifier: AccountId,
    /// Set when a drift report is accepted; cleared if the arbiter rejects it.
    pub frozen: bool,
    /// The code the target executes, from the classifier's evidence. Concentration limits use it
    /// (plan KTD7). None on records written without it: such a target cannot be covered.
    pub resolved_code_hash: Option<String>,
    /// Who can change the code: the global contract owner for `global_by_account`, else the target.
    pub upgrade_authority: Option<AccountId>,
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

/// Most `vault_list` entries one `vaults_by_code_hash` call examines.
pub const MAX_VAULT_SCAN: u32 = 200;

/// One page of `vaults_by_code_hash`. `next` is the `from` for the following call, or `None` at the end.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VaultPage {
    pub items: Vec<VaultRecord>,
    pub next: Option<u32>,
}

#[near]
#[derive(BorshStorageKey)]
enum Key {
    Classifiers,
    Classes,
    Vaults,
    VaultList,
    AllowedHashes,
    Attestors,
    Assignments,
    Reports,
    Nonces,
    LatestReport,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    owner: AccountId,
    factory: Option<AccountId>,
    classifiers: IterableSet<AccountId>,
    classes: LookupMap<AccountId, ClassRecord>,
    vaults: LookupMap<AccountId, VaultRecord>,
    /// Every registered vault, in order, for freeze batches (plan KTD8).
    vault_list: Vector<AccountId>,
    /// Vault code hashes the owner allows for coverage (plan R22).
    allowed_hashes: IterableSet<String>,
    /// Resolves disputes; the protocol owner at first (docs/DECISIONS.md D-43).
    arbiter: AccountId,
    /// Receives slashed bonds as NEAR capital (plan KTD9).
    pool: Option<AccountId>,
    attestors: LookupMap<AccountId, Attestor>,
    /// Each target's assigned attestor, whose heartbeat gates new coverage (D-29).
    assignments: LookupMap<AccountId, AccountId>,
    reports: Vector<StoredReport>,
    used_nonces: LookupSet<(AccountId, u64)>,
    /// The latest report id per target.
    latest_report: LookupMap<AccountId, u32>,
}

#[near]
impl Registry {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner: owner.clone(),
            factory: None,
            classifiers: IterableSet::new(Key::Classifiers),
            classes: LookupMap::new(Key::Classes),
            vaults: LookupMap::new(Key::Vaults),
            vault_list: Vector::new(Key::VaultList),
            allowed_hashes: IterableSet::new(Key::AllowedHashes),
            arbiter: owner.clone(),
            pool: None,
            attestors: LookupMap::new(Key::Attestors),
            assignments: LookupMap::new(Key::Assignments),
            reports: Vector::new(Key::Reports),
            used_nonces: LookupSet::new(Key::Nonces),
            latest_report: LookupMap::new(Key::LatestReport),
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

    pub fn set_class(
        &mut self,
        target: AccountId,
        class: RiskClass,
        evidence_hash: String,
        resolved_code_hash: Option<String>,
        upgrade_authority: Option<AccountId>,
    ) {
        let classifier = env::predecessor_account_id();
        require!(self.classifiers.contains(&classifier), panics::NOT_CLASSIFIER);
        let frozen = self.classes.get(&target).is_some_and(|r| r.frozen);
        let record = ClassRecord { class, evidence_hash, classified_at_block: env::block_height(), classifier, frozen, resolved_code_hash, upgrade_authority };
        emit("target_classified", json!({ "target": target, "record": record }));
        self.classes.insert(target, record);
    }

    // ---- factory only ----

    pub fn register_vault(&mut self, vault: AccountId, owner: AccountId, code_hash: String) {
        require!(Some(env::predecessor_account_id()) == self.factory, panics::NOT_FACTORY);
        let record = VaultRecord { vault: vault.clone(), owner, code_hash, registered_at_block: env::block_height() };
        emit("vault_deployed", json!(record));
        if !self.vaults.contains_key(&vault) {
            self.vault_list.push(vault.clone());
        }
        self.vaults.insert(vault, record);
    }

    // ---- owner: coverage configuration ----

    pub fn allow_vault_code_hash(&mut self, code_hash: String, allowed: bool) {
        self.assert_owner();
        if allowed {
            self.allowed_hashes.insert(code_hash.clone());
        } else {
            self.allowed_hashes.remove(&code_hash);
        }
        emit("vault_code_hash_allowed", json!({ "code_hash": code_hash, "allowed": allowed }));
    }

    pub fn set_arbiter(&mut self, arbiter: AccountId) {
        self.assert_owner();
        emit("arbiter_set", json!({ "before": self.arbiter, "after": arbiter }));
        self.arbiter = arbiter;
    }

    pub fn set_pool(&mut self, pool: AccountId) {
        self.assert_owner();
        emit("pool_set", json!({ "pool": pool }));
        self.pool = Some(pool);
    }

    pub fn assign_attestor(&mut self, target: AccountId, attestor: AccountId) {
        self.assert_owner();
        require!(self.attestors.contains_key(&attestor), "ARUNA_UNKNOWN_ATTESTOR");
        emit("attestor_assigned", json!({ "target": target, "attestor": attestor }));
        self.assignments.insert(target, attestor);
    }

    // ---- views ----

    pub fn get_class(&self, target: AccountId) -> Option<ClassRecord> {
        self.classes.get(&target).cloned()
    }

    pub fn get_vault(&self, vault: AccountId) -> Option<VaultRecord> {
        self.vaults.get(&vault).cloned()
    }

    /// The vault's record, only when it runs a code hash the owner allows for coverage.
    pub fn get_allowed_vault(&self, vault: AccountId) -> Option<VaultRecord> {
        self.vaults.get(&vault).filter(|r| self.allowed_hashes.contains(&r.code_hash)).cloned()
    }

    pub fn allowed_vault_code_hashes(&self) -> Vec<String> {
        self.allowed_hashes.iter().cloned().collect()
    }

    pub fn vault_count(&self) -> u32 {
        self.vault_list.len()
    }

    /// The vaults that run `code_hash`, with the owner recorded at registration (plan R35). A view
    /// over `vault_list` and `vaults`: no state of its own, so it deploys in place.
    ///
    /// One call examines at most `MAX_VAULT_SCAN` entries of `vault_list`, starting at index `from`
    /// (default 0), so its gas does not grow with the registry. `limit` lowers that bound. When
    /// entries remain, `next` is the index to pass as `from`; follow it until it is `None` to see
    /// every match exactly once. An unknown hash gives an empty page, never an error.
    pub fn vaults_by_code_hash(&self, code_hash: String, from: Option<u32>, limit: Option<u32>) -> VaultPage {
        let len = self.vault_list.len();
        let from = from.unwrap_or(0);
        let window = limit.unwrap_or(MAX_VAULT_SCAN).clamp(1, MAX_VAULT_SCAN);
        let end = from.saturating_add(window).min(len);
        let items = (from..end)
            .filter_map(|i| self.vault_list.get(i))
            .filter_map(|v| self.vaults.get(v))
            .filter(|r| r.code_hash == code_hash)
            .cloned()
            .collect();
        VaultPage { items, next: if end < len { Some(end) } else { None } }
    }

    pub fn arbiter(&self) -> AccountId {
        self.arbiter.clone()
    }

    pub fn pool(&self) -> Option<AccountId> {
        self.pool.clone()
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
        r.set_class(acc("t.near"), RiskClass::GlobalByAccount, "H".into(), None, None);
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
        r.set_class(acc("t.near"), RiskClass::ImmutableVerified, "H".into(), None, None);
    }

    #[test]
    #[should_panic(expected = "ARUNA_NOT_AUTHORIZED_CLASSIFIER")]
    fn a_removed_classifier_cannot_write() {
        let mut r = registry();
        r.remove_classifier(acc("classifier.near"));
        as_caller("classifier.near");
        r.set_class(acc("t.near"), RiskClass::Unknown, "H".into(), None, None);
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

#[cfg(test)]
mod tests_drift;
#[cfg(test)]
mod tests_vaults;
