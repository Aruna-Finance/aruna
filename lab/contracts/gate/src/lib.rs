//! gate: the only contract an agent's restricted key may call.
//! execute(target) -> target.version() -> on_version (records what code actually ran).
use near_sdk::{env, log, near, AccountId, Gas, NearToken, Promise, PromiseError};

#[near(contract_state)]
#[derive(Default)]
pub struct Gate {
    calls: u64,
}

#[near]
impl Gate {
    pub fn execute(&mut self, target: AccountId) -> Promise {
        self.calls += 1;
        log!("gate.execute height={} target={}", env::block_height(), target);
        Promise::new(target)
            .function_call("version", Vec::<u8>::new(), NearToken::from_yoctonear(0), Gas::from_tgas(5))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_version",
                Vec::<u8>::new(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(5),
            ))
    }

    #[private]
    pub fn on_version(&self, #[callback_result] r: Result<String, PromiseError>) -> String {
        let v = r.unwrap_or_else(|_| "FAILED".into());
        log!("gate.on_version height={} observed={}", env::block_height(), v);
        v
    }

    /// Exists only so T0 can call a method that is NOT in the key's method_names.
    pub fn other(&self) -> u64 {
        self.calls
    }
}
