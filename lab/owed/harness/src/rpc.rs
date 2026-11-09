//! Minimal JSON-RPC client + transaction builder on top of near-primitives 0.38.
//! near-api 0.8.x cannot build gas-key actions or TransactionV1, so we sign by hand.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use near_crypto::{InMemorySigner, KeyType, PublicKey, SecretKey, Signer};
use near_primitives::account::{AccessKey, AccessKeyPermission, FunctionCallPermission, GasKeyInfo};
use near_primitives::action::{
    Action, AddKeyAction, CreateAccountAction, DeployContractAction, FunctionCallAction,
    TransferAction, TransferToGasKeyAction,
};
use near_primitives::hash::CryptoHash;
use near_primitives::transaction::{
    NonceMode, SignedTransaction, Transaction, TransactionNonce, TransactionV0, TransactionV1,
};
use near_primitives::types::{AccountId, Balance, Gas};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

pub fn near(n: u128) -> Balance {
    Balance::from_yoctonear(n * 10u128.pow(24))
}
pub fn millinear(n: u128) -> Balance {
    Balance::from_yoctonear(n * 10u128.pow(21))
}
pub fn yocto(n: u128) -> Balance {
    Balance::from_yoctonear(n)
}
pub fn tgas(n: u64) -> Gas {
    Gas::from_teragas(n)
}

#[derive(Clone)]
pub struct Key {
    pub account_id: AccountId,
    pub signer: Signer,
}
impl Key {
    pub fn new(account_id: &str, sk: SecretKey) -> Self {
        let account_id: AccountId = account_id.parse().unwrap();
        Self { signer: InMemorySigner::from_secret_key(account_id.clone(), sk), account_id }
    }
    pub fn random(account_id: &str) -> Self {
        Self::new(account_id, SecretKey::from_random(KeyType::ED25519))
    }
    pub fn pk(&self) -> PublicKey {
        self.signer.public_key()
    }
    pub fn id(&self) -> AccountId {
        self.account_id.clone()
    }
}

/// Outcome of a submitted transaction, flattened for reporting.
#[derive(Debug, Clone)]
pub struct Sent {
    pub tx_hash: CryptoHash,
    /// "Ok" if the tx made it on chain and the final status is SuccessValue/SuccessReceiptId,
    /// "OnChainFailure" if included but an action failed,
    /// "Rejected" if the RPC/node refused it before inclusion (no on-chain trace).
    pub kind: &'static str,
    pub error: Value,
    pub raw: Value,
}
impl Sent {
    pub fn ok(&self) -> bool {
        self.kind == "Ok"
    }
    pub fn line(&self) -> String {
        if self.ok() {
            format!("OK   tx={}", self.tx_hash)
        } else {
            format!("FAIL[{}] tx={} err={}", self.kind, self.tx_hash, self.error)
        }
    }
    pub fn logs(&self) -> Vec<String> {
        let mut out = vec![];
        if let Some(rs) = self.raw["receipts_outcome"].as_array() {
            for r in rs {
                for l in r["outcome"]["logs"].as_array().into_iter().flatten() {
                    out.push(l.as_str().unwrap_or_default().to_string());
                }
            }
        }
        out
    }
}

pub struct Rpc {
    pub url: String,
    http: reqwest::Client,
    heights: Mutex<HashMap<String, u64>>,
}

impl Rpc {
    pub fn new(url: &str) -> Self {
        Self { url: url.into(), http: reqwest::Client::new(), heights: Default::default() }
    }

    /// Returns Ok(result) or Err(error json) – the error json is the value we want to record.
    pub async fn call(&self, method: &str, params: Value) -> Result<std::result::Result<Value, Value>> {
        let body = json!({"jsonrpc":"2.0","id":"x","method":method,"params":params});
        let v: Value = self.http.post(&self.url).json(&body).send().await?.json().await?;
        if let Some(e) = v.get("error") {
            return Ok(Err(e.clone()));
        }
        Ok(Ok(v["result"].clone()))
    }

    pub async fn query(&self, params: Value) -> Result<Value> {
        let mut p = params;
        p["finality"] = json!("optimistic");
        match self.call("query", p).await? {
            Ok(v) => {
                if let Some(e) = v.get("error") {
                    return Err(anyhow!("query error: {e}"));
                }
                Ok(v)
            }
            Err(e) => Err(anyhow!("query rpc error: {e}")),
        }
    }

    pub async fn latest_block(&self) -> Result<(CryptoHash, u64)> {
        let b = self.call("block", json!({"finality":"optimistic"})).await?.map_err(|e| anyhow!("{e}"))?;
        Ok((b["header"]["hash"].as_str().unwrap().parse().unwrap(), b["header"]["height"].as_u64().unwrap()))
    }

    pub async fn height_of(&self, block_hash: &str) -> Result<u64> {
        if let Some(h) = self.heights.lock().unwrap().get(block_hash) {
            return Ok(*h);
        }
        let b = self.call("block", json!({"block_id": block_hash})).await?.map_err(|e| anyhow!("{e}"))?;
        let h = b["header"]["height"].as_u64().unwrap();
        self.heights.lock().unwrap().insert(block_hash.into(), h);
        Ok(h)
    }

    pub async fn view_access_key(&self, account: &AccountId, pk: &PublicKey) -> Result<Value> {
        self.query(json!({"request_type":"view_access_key","account_id":account,"public_key":pk.to_string()})).await
    }
    pub async fn view_access_key_list(&self, account: &AccountId) -> Result<Value> {
        self.query(json!({"request_type":"view_access_key_list","account_id":account})).await
    }
    pub async fn view_gas_key_nonces(&self, account: &AccountId, pk: &PublicKey) -> Result<Value> {
        self.query(json!({"request_type":"view_gas_key_nonces","account_id":account,"public_key":pk.to_string()})).await
    }
    pub async fn view_account(&self, account: &AccountId) -> Result<Value> {
        self.query(json!({"request_type":"view_account","account_id":account})).await
    }
    pub async fn view_code_hash(&self, account: &AccountId) -> Result<Value> {
        // view_code returns the code actually resolved for execution (base64) plus its hash
        let v = self.query(json!({"request_type":"view_code","account_id":account})).await?;
        Ok(json!({"hash": v["hash"], "code_len": v["code_base64"].as_str().map(|s| s.len())}))
    }
    pub async fn view_call(&self, account: &AccountId, method: &str, args: Value) -> Result<String> {
        let v = self
            .query(json!({"request_type":"call_function","account_id":account,"method_name":method,
                "args_base64": B64.encode(args.to_string())}))
            .await?;
        let bytes: Vec<u8> = v["result"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect();
        Ok(String::from_utf8_lossy(&bytes).into())
    }

    /// Gas-key balance as seen in view_access_key (permission.GasKeyFunctionCall.balance).
    pub async fn gas_key_balance(&self, account: &AccountId, pk: &PublicKey) -> Result<u128> {
        let v = self.view_access_key(account, pk).await?;
        let perm = &v["permission"];
        let b = perm.get("GasKeyFunctionCall").or_else(|| perm.get("GasKeyFullAccess"))
            .and_then(|g| g["balance"].as_str())
            .ok_or_else(|| anyhow!("not a gas key: {v}"))?;
        Ok(b.parse()?)
    }

    pub async fn next_nonce(&self, key: &Key) -> Result<u64> {
        Ok(self.view_access_key(&key.account_id, &key.pk()).await?["nonce"].as_u64().unwrap() + 1)
    }

    pub async fn next_gas_nonce(&self, key: &Key, idx: u16) -> Result<u64> {
        let v = self.view_gas_key_nonces(&key.account_id, &key.pk()).await?;
        let n = v["nonces"][idx as usize].as_u64().ok_or_else(|| anyhow!("no nonce idx {idx}: {v}"))?;
        Ok(n + 1)
    }

    /// Sign with a normal access key (TransactionV0).
    pub async fn build(&self, key: &Key, receiver: &AccountId, actions: Vec<Action>) -> Result<SignedTransaction> {
        let nonce = self.next_nonce(key).await?;
        let (block_hash, _) = self.latest_block().await?;
        let tx = Transaction::V0(TransactionV0 {
            signer_id: key.account_id.clone(),
            public_key: key.pk(),
            nonce,
            receiver_id: receiver.clone(),
            block_hash,
            actions,
        });
        Ok(sign(tx, &key.signer))
    }

    /// Sign with a gas key (TransactionV1 + GasKeyNonce).
    pub async fn build_gas(&self, key: &Key, idx: u16, receiver: &AccountId, actions: Vec<Action>) -> Result<SignedTransaction> {
        let nonce = self.next_gas_nonce(key, idx).await?;
        let (block_hash, _) = self.latest_block().await?;
        let tx = Transaction::V1(TransactionV1 {
            signer_id: key.account_id.clone(),
            public_key: key.pk(),
            nonce: TransactionNonce::from_nonce_and_index(nonce, idx),
            receiver_id: receiver.clone(),
            block_hash,
            actions,
            nonce_mode: NonceMode::Monotonic,
        });
        Ok(sign(tx, &key.signer))
    }

    pub async fn submit(&self, stx: &SignedTransaction, wait_until: &str) -> Result<Sent> {
        let tx_hash = stx.get_hash();
        let b = B64.encode(borsh::to_vec(stx)?);
        let r = self.call("send_tx", json!({"signed_tx_base64": b, "wait_until": wait_until})).await?;
        Ok(classify(tx_hash, r))
    }

    pub async fn send(&self, key: &Key, receiver: &AccountId, actions: Vec<Action>) -> Result<Sent> {
        let stx = self.build(key, receiver, actions).await?;
        self.submit(&stx, "FINAL").await
    }
    pub async fn send_gas(&self, key: &Key, idx: u16, receiver: &AccountId, actions: Vec<Action>) -> Result<Sent> {
        let stx = self.build_gas(key, idx, receiver, actions).await?;
        self.submit(&stx, "FINAL").await
    }

    pub async fn tx_status(&self, tx_hash: &CryptoHash, sender: &AccountId) -> Result<Sent> {
        let r = self
            .call("EXPERIMENTAL_tx_status", json!({"tx_hash": tx_hash.to_string(), "sender_account_id": sender, "wait_until":"FINAL"}))
            .await?;
        Ok(classify(*tx_hash, r))
    }
}

fn classify(tx_hash: CryptoHash, r: std::result::Result<Value, Value>) -> Sent {
    match r {
        Err(e) => Sent { tx_hash, kind: "Rejected", error: e.get("data").cloned().unwrap_or(e.clone()), raw: e },
        Ok(v) => {
            let st = &v["status"];
            if let Some(f) = st.get("Failure") {
                Sent { tx_hash, kind: "OnChainFailure", error: f.clone(), raw: v }
            } else {
                // a receipt further down may still have failed (e.g. callback); surface the first failure
                let inner = v["receipts_outcome"].as_array().into_iter().flatten()
                    .find_map(|r| r["outcome"]["status"].get("Failure").cloned());
                match inner {
                    Some(f) => Sent { tx_hash, kind: "OnChainFailure", error: f, raw: v },
                    None => Sent { tx_hash, kind: "Ok", error: Value::Null, raw: v },
                }
            }
        }
    }
}

pub fn sign(tx: Transaction, signer: &Signer) -> SignedTransaction {
    let (hash, _) = tx.get_hash_and_size();
    SignedTransaction::new(signer.sign(hash.as_ref()), tx)
}

// ---- action helpers ----
pub fn a_create() -> Action {
    Action::CreateAccount(CreateAccountAction {})
}
pub fn a_transfer(b: Balance) -> Action {
    Action::Transfer(TransferAction { deposit: b })
}
pub fn a_deploy(code: Vec<u8>) -> Action {
    Action::DeployContract(DeployContractAction { code })
}
pub fn a_call(method: &str, args: Value, gas: Gas, deposit: Balance) -> Action {
    Action::FunctionCall(Box::new(FunctionCallAction {
        method_name: method.into(),
        args: args.to_string().into_bytes(),
        gas,
        deposit,
    }))
}
pub fn a_call_raw(method: &str, args: Vec<u8>, gas: Gas, deposit: Balance) -> Action {
    Action::FunctionCall(Box::new(FunctionCallAction { method_name: method.into(), args, gas, deposit }))
}
pub fn a_add_full(pk: PublicKey) -> Action {
    Action::AddKey(Box::new(AddKeyAction { public_key: pk, access_key: AccessKey::full_access() }))
}
pub fn a_add_fc(pk: PublicKey, receiver: &str, methods: &[&str]) -> Action {
    Action::AddKey(Box::new(AddKeyAction {
        public_key: pk,
        access_key: AccessKey {
            nonce: 0,
            permission: AccessKeyPermission::FunctionCall(FunctionCallPermission {
                allowance: None,
                receiver_id: receiver.into(),
                method_names: methods.iter().map(|s| s.to_string()).collect(),
            }),
        },
    }))
}
pub fn a_add_gas_fc(pk: PublicKey, balance: Balance, num_nonces: u16, receiver: &str, methods: &[&str]) -> Action {
    Action::AddKey(Box::new(AddKeyAction {
        public_key: pk,
        access_key: AccessKey {
            nonce: 0,
            permission: AccessKeyPermission::GasKeyFunctionCall(
                GasKeyInfo { balance, num_nonces },
                FunctionCallPermission {
                    allowance: None,
                    receiver_id: receiver.into(),
                    method_names: methods.iter().map(|s| s.to_string()).collect(),
                },
            ),
        },
    }))
}
pub fn a_to_gas_key(pk: PublicKey, deposit: Balance) -> Action {
    Action::TransferToGasKey(Box::new(TransferToGasKeyAction { public_key: pk, deposit }))
}
