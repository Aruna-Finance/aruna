//! drift-target: the covered target in the coverage loop (plan KTD11, R30). It swaps NEAR (`swap`)
//! and the test USDC (`ft_on_transfer`) for the vault's two adapters, keeping a 0.5% fee and paying
//! the rest back to its caller only. It is published as a global contract BY ACCOUNT under a
//! target-owner account; v1 and v2 differ only in `version()`, so the owner's redeploy is a real code
//! change that `view_account.code_hash` on the target never shows.
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseOrValue};

pub const FEE_BPS: u128 = 50;

#[near(contract_state)]
#[derive(Default)]
pub struct DriftTarget {}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct SwapMsg {
    min_amount_out: U128,
}

fn after_fee(input: u128) -> u128 {
    input - input * FEE_BPS / 10_000
}

#[near]
impl DriftTarget {
    /// NEAR in, NEAR out to the caller. Fails below `min_amount_out`.
    #[payable]
    pub fn swap(&mut self, min_amount_out: U128) -> U128 {
        let out = after_fee(env::attached_deposit().as_yoctonear());
        require!(out >= min_amount_out.0, "SWAP_SLIPPAGE: output below min_amount_out");
        Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(out)).detach();
        U128(out)
    }

    /// Token in through `ft_transfer_call`, the same token back to `sender_id`. A message that does
    /// not parse, or an output below the minimum, returns the whole amount as unused.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let Ok(m) = serde_json::from_str::<SwapMsg>(&msg) else {
            return PromiseOrValue::Value(amount);
        };
        let out = after_fee(amount.0);
        if out < m.min_amount_out.0 {
            return PromiseOrValue::Value(amount);
        }
        let token: AccountId = env::predecessor_account_id();
        let args = serde_json::json!({ "receiver_id": sender_id, "amount": U128(out) }).to_string();
        Promise::new(token)
            .function_call("ft_transfer".to_string(), args.into_bytes(), NearToken::from_yoctonear(1), Gas::from_tgas(10))
            .detach();
        PromiseOrValue::Value(U128(0))
    }

    pub fn version() -> String {
        if cfg!(feature = "v2") { "drift-target-v2".to_string() } else { "drift-target-v1".to_string() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str, deposit: u128) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).attached_deposit(NearToken::from_yoctonear(deposit)).build());
    }

    #[test]
    fn a_near_swap_keeps_half_a_percent() {
        ctx("vault.testnet", 10_000);
        assert_eq!(DriftTarget::default().swap(U128(9_950)), U128(9_950));
    }

    #[test]
    #[should_panic(expected = "SWAP_SLIPPAGE")]
    fn a_near_swap_fails_below_the_minimum() {
        ctx("vault.testnet", 10_000);
        DriftTarget::default().swap(U128(9_951));
    }

    fn unused(r: PromiseOrValue<U128>) -> u128 {
        match r {
            PromiseOrValue::Value(v) => v.0,
            PromiseOrValue::Promise(_) => panic!("expected a value"),
        }
    }

    #[test]
    fn a_token_swap_uses_the_whole_amount() {
        ctx("usdc.testnet", 0);
        let r = DriftTarget::default().ft_on_transfer("vault.testnet".parse().unwrap(), U128(1_000_000), "{\"min_amount_out\":\"995000\"}".into());
        assert_eq!(unused(r), 0);
    }

    #[test]
    fn a_malformed_message_returns_everything() {
        ctx("usdc.testnet", 0);
        let r = DriftTarget::default().ft_on_transfer("vault.testnet".parse().unwrap(), U128(1_000_000), "swap please".into());
        assert_eq!(unused(r), 1_000_000);
    }

    #[test]
    fn a_token_swap_below_the_minimum_returns_everything() {
        ctx("usdc.testnet", 0);
        let r = DriftTarget::default().ft_on_transfer("vault.testnet".parse().unwrap(), U128(1_000_000), "{\"min_amount_out\":\"995001\"}".into());
        assert_eq!(unused(r), 1_000_000);
    }

    #[test]
    fn version_follows_the_build() {
        assert_eq!(DriftTarget::version(), if cfg!(feature = "v2") { "drift-target-v2" } else { "drift-target-v1" });
    }
}
