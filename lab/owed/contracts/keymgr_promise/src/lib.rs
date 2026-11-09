//! keymgr_promise: the same surface as keymgr, written with near-sdk's `Promise`.
//! Exists only so T7c can compare compiled imports (docs/NEAR-FACTS.md §4).
use near_sdk::json_types::U128;
use near_sdk::{env, log, near, AccountId, Allowance, Promise, PublicKey};

#[near(contract_state)]
#[derive(Default)]
pub struct KeyMgrPromise {}

#[near]
impl KeyMgrPromise {
    pub fn version() -> String {
        "keymgr_promise".into()
    }

    pub fn spend() -> u64 {
        log!("spend height={}", env::block_height());
        env::block_height()
    }

    pub fn cb_settle() -> String {
        "cb_settle".into()
    }

    pub fn add_fc_key(public_key: PublicKey, methods: String, allowance: Option<U128>) -> Promise {
        let allowance = match allowance {
            Some(a) => Allowance::Limited(a.0.try_into().expect("allowance must be non-zero")),
            None => Allowance::Unlimited,
        };
        Promise::new(env::current_account_id()).add_access_key_allowance(
            public_key,
            allowance,
            env::current_account_id(),
            methods,
        )
    }

    pub fn delete_key(public_key: PublicKey) -> Promise {
        Promise::new(env::current_account_id()).delete_key(public_key)
    }

    pub fn delete_self(beneficiary: AccountId) -> Promise {
        Promise::new(env::current_account_id()).delete_account(beneficiary)
    }
}
