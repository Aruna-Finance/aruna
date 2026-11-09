//! Owner-only actions (docs/CONTRACTS.md "Owner and operator"). The operator can do none of these.
//! Each requires exactly 1 yoctoNEAR attached: a function-call key cannot attach a deposit
//! (docs/NEAR-FACTS.md §2), so only a full-access key of the owner's account can call them — not a
//! dApp key the owner once granted.

use crate::{Ceiling, Vault, VaultExt};
use aruna_common::emit;
use aruna_common::reasons::panics;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, NearToken};

impl Vault {
    pub(crate) fn is_owner(&self) -> bool {
        env::predecessor_account_id() == self.owner
    }

    pub(crate) fn is_operator(&self) -> bool {
        self.operator.as_ref() == Some(&env::predecessor_account_id())
    }

    pub(crate) fn assert_owner(&self) {
        require!(self.is_owner(), panics::NOT_OWNER);
    }

    pub(crate) fn assert_owner_or_operator(&self) {
        require!(self.is_owner() || self.is_operator(), panics::NOT_OWNER_OR_OPERATOR);
    }
}

#[near]
impl Vault {
    #[payable]
    pub fn set_ceiling(&mut self, ceiling: Ceiling) {
        assert_one_yocto();
        self.assert_owner();
        emit("ceiling_updated", json!({ "before": self.ceiling, "after": ceiling }));
        self.ceiling = ceiling;
    }

    /// Set or remove the operator. A vault with no operator is a plain owner vault.
    #[payable]
    pub fn set_operator(&mut self, operator: Option<AccountId>) {
        assert_one_yocto();
        self.assert_owner();
        emit("operator_changed", json!({ "before": self.operator, "after": operator }));
        self.operator = operator;
    }

    /// Owner recovery is a state change: there is no key to hand over.
    #[payable]
    pub fn set_owner(&mut self, owner: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        emit("owner_changed", json!({ "before": self.owner, "after": owner }));
        self.owner = owner;
    }

    /// Owner-only, available in every state, and pays only the registered owner (docs/CONTRACTS.md).
    #[payable]
    pub fn withdraw_to_owner(&mut self, amount: U128) {
        assert_one_yocto();
        self.assert_owner();
        emit("withdrawal", json!({ "to": self.owner, "amount": amount }));
        let p = env::promise_batch_create(&self.owner);
        env::promise_batch_action_transfer(p, NearToken::from_yoctonear(amount.0));
    }
}
