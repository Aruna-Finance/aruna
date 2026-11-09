//! Helpers for the sandbox tests. `rpc` is the lab's hand-signing client (lab/harness/src/rpc.rs),
//! used where near-workspaces has no API: global contract deploys and transactions signed by an
//! agent's function-call key, whose rejections must be read as RPC errors.
#![allow(dead_code)]
pub mod rpc;

use std::path::PathBuf;

pub fn wasm(name: &str) -> Vec<u8> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../target/near/{name}/{name}.wasm"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("{}: {e}. Build the contracts first (see integration/Cargo.toml)", p.display()))
}

/// near-workspaces' secret key, as the lab client's signer.
pub fn key_of(account: &near_workspaces::Account) -> rpc::Key {
    rpc::Key::new(account.id().as_str(), account.secret_key().to_string().parse().unwrap())
}
