//! factory — deploys vaults from one global contract by hash (docs/CONTRACTS.md).
//!
//! One batch creates `<name>.<factory>`, funds it, binds it to the vault code by hash, and calls
//! `new` — and adds no key of any kind. The vault is then registered with the registry, including
//! its code hash for version tracking. The factory is not claimed immutable; the vaults are.

use aruna_common::emit;
use aruna_common::reasons::panics;
use near_sdk::json_types::Base58CryptoHash;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

/// Funds the vault's storage and its agents' gas allowances. Checked, not guessed: storage for a
/// vault with a few agents is well under this on testnet.
pub const MIN_DEPOSIT: NearToken = NearToken::from_millinear(500);
const GAS_INIT: Gas = Gas::from_tgas(15);
const GAS_REGISTER: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(25);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    owner: AccountId,
    registry: AccountId,
    /// Global contract hash of the current vault version.
    vault_code_hash: Base58CryptoHash,
}

#[near]
impl Factory {
    #[init]
    pub fn new(owner: AccountId, registry: AccountId, vault_code_hash: Base58CryptoHash) -> Self {
        Self { owner, registry, vault_code_hash }
    }

    /// A new vault version is a new global contract hash. Existing vaults keep their code forever.
    pub fn set_vault_code_hash(&mut self, vault_code_hash: Base58CryptoHash) {
        require!(env::predecessor_account_id() == self.owner, panics::NOT_OWNER);
        emit("vault_version_set", json!({ "before": self.vault_code_hash, "after": vault_code_hash }));
        self.vault_code_hash = vault_code_hash;
    }

    /// Creates `<name>.<this factory>` for `owner`, optionally run by `operator`. The attached
    /// deposit becomes the vault's balance. `ceiling` is passed to the vault, which validates it.
    #[payable]
    pub fn create_vault(&mut self, name: String, owner: AccountId, operator: Option<AccountId>, ceiling: Value) -> Promise {
        let deposit = env::attached_deposit();
        require!(deposit >= MIN_DEPOSIT, "ARUNA_DEPOSIT_TOO_SMALL");
        let vault: AccountId = format!("{name}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("ARUNA_BAD_VAULT_NAME"));
        let args = json!({ "owner": owner, "operator": operator, "registry": self.registry, "ceiling": ceiling });

        Promise::new(vault.clone())
            .create_account()
            .transfer(deposit)
            .use_global_contract(self.vault_code_hash)
            .function_call("new", args.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_INIT)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .cb_vault_created(vault, owner, env::predecessor_account_id(), deposit),
            )
    }

    #[private]
    pub fn cb_vault_created(
        &mut self,
        vault: AccountId,
        owner: AccountId,
        payer: AccountId,
        deposit: NearToken,
        #[callback_result] created: Result<(), PromiseError>,
    ) -> Option<AccountId> {
        if created.is_err() {
            // The failed batch refunds the deposit to this factory; return it to whoever paid.
            emit("vault_creation_failed", json!({ "vault": vault, "payer": payer }));
            Promise::new(payer).transfer(deposit).detach();
            return None;
        }
        let code_hash = String::from(&self.vault_code_hash);
        emit("vault_created", json!({ "vault": vault, "owner": owner, "code_hash": code_hash }));
        Promise::new(self.registry.clone())
            .function_call(
                "register_vault",
                json!({ "vault": vault, "owner": owner, "code_hash": code_hash }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_REGISTER,
            )
            .detach();
        Some(vault)
    }

    pub fn get_config(&self) -> Value {
        json!({ "owner": self.owner, "registry": self.registry, "vault_code_hash": self.vault_code_hash, "min_deposit": MIN_DEPOSIT })
    }
}
