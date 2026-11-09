//! keymgr: manages its own function-call keys with near-sdk's low-level promise functions only
//! (no `Promise`), the pattern the vault must use (CLAUDE.md rule 11). Also exposes a callback-named
//! method for T8 and a self-delete for T9. Lab code: no access control on purpose.
use near_sdk::json_types::U128;
use near_sdk::{env, log, near, AccountId, Allowance, PublicKey};

#[near(contract_state)]
#[derive(Default)]
pub struct KeyMgr {}

#[near]
impl KeyMgr {
    pub fn version() -> String {
        "keymgr".into()
    }

    /// A method an agent key is allowed to call.
    pub fn spend() -> u64 {
        log!("spend height={}", env::block_height());
        env::block_height()
    }

    /// Named like a callback. An agent key restricted to `spend` must never reach it (T8).
    pub fn cb_settle() -> String {
        log!("cb_settle reached, signer={}", env::signer_account_id());
        "cb_settle".into()
    }

    /// Adds a function-call key on this account for `methods` (comma-separated) on this account.
    /// `allowance` in yoctoNEAR; absent means unlimited.
    pub fn add_fc_key(public_key: PublicKey, methods: String, allowance: Option<U128>) {
        let me = env::current_account_id();
        let allowance = match allowance {
            Some(a) => Allowance::Limited(a.0.try_into().expect("allowance must be non-zero")),
            None => Allowance::Unlimited,
        };
        let p = env::promise_batch_create(&me);
        env::promise_batch_action_add_key_allowance_with_function_call(
            p,
            &public_key,
            0,
            allowance,
            &me,
            &methods,
        );
    }

    pub fn delete_key(public_key: PublicKey) {
        let p = env::promise_batch_create(&env::current_account_id());
        env::promise_batch_action_delete_key(p, &public_key);
    }

    /// Deletes this account, sending the balance to `beneficiary` (T9).
    pub fn delete_self(beneficiary: AccountId) {
        let p = env::promise_batch_create(&env::current_account_id());
        env::promise_batch_action_delete_account(p, &beneficiary);
    }
}
