//! swap: a testnet swap target for the vault's one adapter (docs/DECISIONS.md D-49).
//! `swap(min_amount_out)` takes the attached NEAR, keeps a 0.5% fee and sends the rest back to the
//! caller — always the caller, so an adapter using it cannot route proceeds anywhere else. It fails
//! when the output would be below `min_amount_out`, which is how slippage protection is exercised.
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, NearToken, Promise};

pub const FEE_BPS: u128 = 50;

#[near(contract_state)]
#[derive(Default)]
pub struct Swap {}

#[near]
impl Swap {
    #[payable]
    pub fn swap(&mut self, min_amount_out: U128) -> U128 {
        let input = env::attached_deposit().as_yoctonear();
        let out = input - input * FEE_BPS / 10_000;
        require!(out >= min_amount_out.0, "SWAP_SLIPPAGE: output below min_amount_out");
        Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(out)).detach();
        U128(out)
    }

    pub fn version() -> String {
        "swap-v1".into()
    }
}
