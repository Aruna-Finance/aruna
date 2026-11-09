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

pub fn fixture_wasm(rel: &str) -> Vec<u8> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/wasm").join(rel);
    std::fs::read(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

use near_primitives::action::{Action, DeployGlobalContractAction, GlobalContractDeployMode};
use near_primitives::hash::CryptoHash;
use near_primitives::transaction::{Transaction, TransactionV0};
use near_primitives::types::AccountId;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{json, Value};

pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

/// Prepaid gas on an agent's call. The node reserves it from the key's allowance at a pessimistic
/// price while the call is in flight (docs/NEAR-FACTS.md §10), so it bounds how many calls an agent
/// can have in flight at once.
pub const AGENT_TGAS: u64 = 60;

/// A sandbox with the registry, the factory, a swap target and one vault created by the factory:
/// `acme.aruna.test.near`, owned by `client`, operated by `company`.
pub struct Env {
    pub worker: near_workspaces::Worker<near_workspaces::network::Sandbox>,
    pub lab: rpc::Rpc,
    pub owner: near_workspaces::Account,
    pub registry: near_workspaces::Contract,
    pub client: near_workspaces::Account,
    pub company: near_workspaces::Account,
    pub vault: AccountId,
    pub swap: AccountId,
}

impl Env {
    pub async fn new(vault_deposit_near: u128, ceiling: Value) -> anyhow::Result<Env> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let lab = rpc::Rpc::new(&worker.rpc_addr());
        let sub = |name: &'static str, near: u128| {
            let root = root.clone();
            async move { root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result().map_err(anyhow::Error::from) }
        };

        let vault_code = wasm("aruna_vault");
        let vault_hash = CryptoHash::hash_bytes(&vault_code);
        let publisher = sub("publisher", 100).await?;
        let s = lab
            .send(&key_of(&publisher), &publisher.id().as_str().parse()?, vec![Action::DeployGlobalContract(DeployGlobalContractAction {
                code: vault_code.into(),
                deploy_mode: GlobalContractDeployMode::CodeHash,
            })])
            .await?;
        anyhow::ensure!(s.ok(), "global deploy: {}", s.line());

        let owner = sub("owner", 30).await?;
        let registry = sub("registry", 20).await?.deploy(&wasm("aruna_registry")).await?.into_result()?;
        registry.call("new").args_json(json!({ "owner": owner.id() })).transact().await?.into_result()?;
        owner.call(registry.id(), "add_classifier").args_json(json!({ "account": owner.id() })).transact().await?.into_result()?;
        let factory = sub("aruna", 30).await?.deploy(&wasm("aruna_factory")).await?.into_result()?;
        factory
            .call("new")
            .args_json(json!({ "owner": owner.id(), "registry": registry.id(), "vault_code_hash": vault_hash.to_string() }))
            .transact()
            .await?
            .into_result()?;
        owner.call(registry.id(), "set_factory").args_json(json!({ "factory": factory.id() })).transact().await?.into_result()?;
        let swap = sub("swap", 50).await?.deploy(&fixture_wasm("swap/swap.wasm")).await?.into_result()?;

        let client = sub("client", 20).await?;
        let company = sub("company", 50).await?;
        let r = company
            .call(factory.id(), "create_vault")
            .args_json(json!({ "name": "acme", "owner": client.id(), "operator": company.id(), "ceiling": ceiling }))
            .deposit(NearToken::from_near(vault_deposit_near))
            .gas(Gas::from_tgas(150))
            .transact()
            .await?;
        anyhow::ensure!(r.is_success(), "create_vault: {:?}", r.failures());
        Ok(Env {
            vault: format!("acme.{}", factory.id()).parse()?,
            swap: swap.id().as_str().parse()?,
            worker,
            lab,
            owner,
            registry,
            client,
            company,
        })
    }

    pub fn vault_ws(&self) -> near_workspaces::AccountId {
        self.vault.as_str().parse().unwrap()
    }

    /// The registry's authorized classifier records a class for a target.
    pub async fn classify(&self, target: &AccountId, class: &str) -> anyhow::Result<()> {
        self.owner
            .call(self.registry.id(), "set_class")
            .args_json(json!({ "target": target, "class": class, "evidence_hash": "test" }))
            .transact()
            .await?
            .into_result()?;
        Ok(())
    }

    /// Signs with an agent's function-call key on the vault, as an agent would.
    pub async fn agent_call(&self, agent: &rpc::Key, method: &str, args: Value) -> anyhow::Result<rpc::Sent> {
        self.lab.send(agent, &self.vault, vec![rpc::a_call(method, args, rpc::tgas(AGENT_TGAS), rpc::yocto(0))]).await
    }

    /// `n` transactions from one key, signed with consecutive nonces and submitted at once.
    pub async fn agent_calls_parallel(&self, agent: &rpc::Key, method: &str, args: Vec<Value>) -> anyhow::Result<Vec<rpc::Sent>> {
        let first = self.lab.next_nonce(agent).await?;
        let (block_hash, _) = self.lab.latest_block().await?;
        let txs: Vec<_> = args
            .into_iter()
            .enumerate()
            .map(|(i, a)| {
                rpc::sign(
                    Transaction::V0(TransactionV0 {
                        signer_id: agent.id(),
                        public_key: agent.pk(),
                        nonce: first + i as u64,
                        receiver_id: self.vault.clone(),
                        block_hash,
                        actions: vec![rpc::a_call(method, a, rpc::tgas(AGENT_TGAS), rpc::yocto(0))],
                    }),
                    &agent.signer,
                )
            })
            .collect();
        let sent = futures::future::join_all(txs.iter().map(|t| self.lab.submit(t, "FINAL"))).await;
        sent.into_iter().collect()
    }

    pub async fn view(&self, method: &str, args: Value) -> anyhow::Result<Value> {
        Ok(self.worker.view(&self.vault_ws(), method).args_json(args).await?.json()?)
    }

    pub async fn balance(&self, id: &AccountId) -> anyhow::Result<u128> {
        Ok(self.lab.view_account(id).await?["amount"].as_str().unwrap().parse()?)
    }
}

/// The value a transaction returned, decoded as JSON.
pub fn returned(s: &rpc::Sent) -> Value {
    use base64::Engine;
    let b64 = s.raw["status"]["SuccessValue"].as_str().unwrap_or("");
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap_or_default();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

/// NEP-297 events with a given name in a transaction's logs.
pub fn events(s: &rpc::Sent, name: &str) -> Vec<Value> {
    s.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .filter(|e| e["event"] == name)
        .collect()
}
