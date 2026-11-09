//! usdc: minimal NEP-141-shaped token. ft_transfer enforces exactly 1 yoctoNEAR like the standard.
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{assert_one_yocto, env, log, near, require, AccountId, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Usdc {
    balances: LookupMap<AccountId, u128>,
}

#[near]
impl Usdc {
    #[init]
    pub fn new() -> Self {
        Self { balances: LookupMap::new(b"b") }
    }

    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        let b = self.balances.get(&account_id).copied().unwrap_or(0);
        self.balances.insert(account_id, b + amount.0);
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        let sb = self.balances.get(&sender).copied().unwrap_or(0);
        require!(sb >= amount.0, "insufficient balance");
        self.balances.insert(sender.clone(), sb - amount.0);
        let rb = self.balances.get(&receiver_id).copied().unwrap_or(0);
        self.balances.insert(receiver_id.clone(), rb + amount.0);
        log!("ft_transfer {} -> {} {} memo={:?}", sender, receiver_id, amount.0, memo);
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }
}
