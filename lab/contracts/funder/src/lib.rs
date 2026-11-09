//! funder: a third-party contract that tries to top up someone else's gas key
//! via promise_batch_action_transfer_to_gas_key (T1 variant), and a factory that
//! creates+funds an agent in one promise batch (T1a variant through a contract).
use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, Allowance, NearToken, Promise, PublicKey};

#[near(contract_state)]
#[derive(Default)]
pub struct Funder {}

#[near]
impl Funder {
    /// Top up a gas key on an account that is NOT this contract.
    pub fn fund(&self, account_id: AccountId, public_key: PublicKey, amount: U128) -> Promise {
        Promise::new(account_id).transfer_to_gas_key(public_key, NearToken::from_yoctonear(amount.0))
    }

    /// Create `<name>.<this>` with only a GasKeyFunctionCall key, funded in the same batch.
    pub fn create_agent(
        &self,
        name: String,
        public_key: PublicKey,
        gas_amount: U128,
        receiver_id: AccountId,
        method_names: String,
    ) -> Promise {
        let id: AccountId = format!("{}.{}", name, near_sdk::env::current_account_id()).parse().unwrap();
        Promise::new(id)
            .create_account()
            .transfer(NearToken::from_millinear(10))
            .add_gas_key_allowance_function_call(public_key.clone(), 4, Allowance::Unlimited, receiver_id, method_names)
            .transfer_to_gas_key(public_key, NearToken::from_yoctonear(gas_amount.0))
    }
}
