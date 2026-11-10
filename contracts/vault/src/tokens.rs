//! Fungible tokens (plan R3). The vault holds NEP-141 tokens listed in the owner's ceiling and moves
//! them only through `ft_transfer_call` to an adapter target, or `ft_transfer` to the owner. Both need
//! exactly 1 yoctoNEAR, which the vault attaches itself; an agent key never can (docs/NEAR-FACTS.md §2).
//!
//! The vault does not mirror its token balances: the token contract is the record, and a transfer the
//! vault cannot cover fails at the token and releases its reservation in `cb_settle`.

use crate::{Vault, VaultExt};
use aruna_common::{emit, TokenId};
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Gas, NearToken, PromiseIndex};

/// Gas for `ft_transfer_call`, including the receiver's `ft_on_transfer` and the token's resolve step.
pub(crate) const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(60);
pub(crate) const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);

impl Vault {
    pub(crate) fn accepts_token(&self, token: &TokenId) -> bool {
        self.ceiling.tokens.iter().any(|t| &t.token == token)
    }

    /// `ft_transfer` from this vault, with the 1 yoctoNEAR NEP-141 requires. Low-level promises only.
    pub(crate) fn send_ft(token: &AccountId, receiver: &AccountId, amount: u128) -> PromiseIndex {
        let args = json!({ "receiver_id": receiver, "amount": U128(amount) }).to_string();
        env::promise_create(token.clone(), "ft_transfer", args, NearToken::from_yoctonear(1), GAS_FT_TRANSFER)
    }
}

#[near]
impl Vault {
    /// NEP-141 receiver. Accepts deposits only from tokens in the ceiling; anything else is returned
    /// in full. A deposit only adds to the owner's funds, so any sender may make one.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let token = TokenId::Ft(env::predecessor_account_id());
        if !self.accepts_token(&token) {
            return amount;
        }
        emit("deposit", json!({ "token": token, "from": sender_id, "amount": amount, "msg": msg }));
        U128(0)
    }
}
