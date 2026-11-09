//! target: version() returns "v1" (default build) or "v2" (--features v2).
use near_sdk::{env, log, near, AccountContract, Promise};

#[near(contract_state)]
#[derive(Default)]
pub struct Target {}

#[near]
impl Target {
    pub fn version() -> String {
        let v = if cfg!(feature = "v2") { "v2" } else { "v1" };
        log!("target.version height={} account={} returns={}", env::block_height(), env::current_account_id(), v);
        v.into()
    }

    /// What the runtime says about the code currently executing in this account.
    pub fn code_info() -> String {
        let s = match env::current_contract_code() {
            AccountContract::None => "none".to_string(),
            AccountContract::Local(h) => format!("local:{}", near_sdk::bs58::encode(h).into_string()),
            AccountContract::Global(h) => format!("global_hash:{}", near_sdk::bs58::encode(h).into_string()),
            AccountContract::GlobalByAccount(a) => format!("global_account:{a}"),
        };
        log!("code_info height={} {}", env::block_height(), s);
        s
    }

    /// Redeploys own code via a promise (an extra receipt hop compared to a direct DeployContract tx).
    #[private]
    pub fn self_upgrade(&self, #[serializer(borsh)] code: Vec<u8>) -> Promise {
        log!("target.self_upgrade height={}", env::block_height());
        Promise::new(env::current_account_id()).deploy_contract(code)
    }
}
