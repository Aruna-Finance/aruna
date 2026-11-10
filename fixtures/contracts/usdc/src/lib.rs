//! usdc: a TEST NEP-141 token for the coverage loop on testnet (plan KTD11). Six decimals like USDC,
//! minted only by its owner. It is not USDC and has no value.
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Usdc {
    owner: AccountId,
    token: FungibleToken,
}

#[near]
impl Usdc {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        let mut token = FungibleToken::new(b"t".to_vec());
        token.internal_register_account(&owner);
        Self { owner, token }
    }

    /// Owner only. The receiver must already be registered (storage_deposit).
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.owner, "only the owner mints");
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint { owner_id: &account_id, amount: amount, memo: Some("test mint") }.emit();
    }
}

#[near]
impl FungibleTokenCore for Usdc {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Usdc {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Usdc {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Usdc {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Aruna test USDC (no value)".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).attached_deposit(NearToken::from_millinear(10)).build());
    }

    #[test]
    fn the_owner_mints_to_a_registered_account() {
        ctx("owner.testnet");
        let mut t = Usdc::new("owner.testnet".parse().unwrap());
        t.storage_deposit(Some("vault.testnet".parse().unwrap()), None);
        t.mint("vault.testnet".parse().unwrap(), U128(5_000_000));
        assert_eq!(t.ft_balance_of("vault.testnet".parse().unwrap()), U128(5_000_000));
    }

    #[test]
    #[should_panic(expected = "only the owner mints")]
    fn nobody_else_mints() {
        ctx("owner.testnet");
        let mut t = Usdc::new("owner.testnet".parse().unwrap());
        ctx("stranger.testnet");
        t.mint("owner.testnet".parse().unwrap(), U128(1));
    }
}
