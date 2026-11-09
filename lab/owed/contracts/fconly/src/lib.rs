//! fconly: can add a function-call key to its own account and nothing else.
//! Its only `promise_batch_action_*` import should be `promise_batch_action_add_key_with_function_call`
//! (T7b). Lab code: no access control on purpose.
use near_sdk::{env, near, Allowance, PublicKey};

#[near(contract_state)]
#[derive(Default)]
pub struct FcOnly {}

#[near]
impl FcOnly {
    pub fn version() -> String {
        "fconly".into()
    }

    /// Adds a function-call key on this account, limited to `method` on this account.
    pub fn add_fc_key(public_key: PublicKey, method: String) {
        let me = env::current_account_id();
        let p = env::promise_batch_create(&me);
        env::promise_batch_action_add_key_allowance_with_function_call(
            p,
            &public_key,
            0,
            Allowance::Unlimited,
            &me,
            &method,
        );
    }
}
