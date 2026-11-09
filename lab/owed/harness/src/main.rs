//! Owed lab tests T5–T9 (docs/TESTING.md), against a local nearcore sandbox.
//!
//! The original lab exercised gas keys on sub-accounts. The product uses classic function-call keys
//! on a contract account, so these tests re-establish the claims the vault and self-classification
//! rest on. Results go to lab/results/owed_*.json; existing result files are never touched.
//!
//! Build the contracts first:
//!   (cd lab/owed/contracts/<c> && cargo near build non-reproducible-wasm --no-abi)   # fconly keymgr keymgr_promise
//! Run:
//!   cargo run --release --manifest-path lab/owed/Cargo.toml -- [t5|t6|t7|t8|t9|all]

mod rpc;

use anyhow::Result;
use near_primitives::account::{AccessKey, AccessKeyPermission, FunctionCallPermission};
use near_primitives::action::{
    Action, AddKeyAction, DeleteKeyAction, DeployGlobalContractAction, GlobalContractDeployMode,
    GlobalContractIdentifier, UseGlobalContractAction,
};
use near_primitives::hash::CryptoHash;
use near_primitives::types::{AccountId, Balance};
use rpc::*;
use serde_json::{json, Value};
use std::time::Duration;

const WASM_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/near");
const RESULTS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../results");

/// Host functions the classifier scans (docs/CLASSIFIER.md step 3).
const SCANNED: &[&str] = &[
    "promise_batch_action_deploy_contract",
    "promise_batch_action_use_global_contract",
    "promise_batch_action_use_global_contract_by_account_id",
    "promise_batch_action_add_key_with_full_access",
    "promise_batch_action_add_gas_key_with_full_access",
    "promise_batch_action_delete_account",
];

fn wasm(name: &str) -> Vec<u8> {
    let p = format!("{WASM_DIR}/{name}/{name}.wasm");
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e} (build contracts first)"))
}

/// Imported function names of a module, in order.
fn imports(code: &[u8]) -> Result<Vec<String>> {
    let mut out = vec![];
    for payload in wasmparser::Parser::new(0).parse_all(code) {
        if let wasmparser::Payload::ImportSection(reader) = payload? {
            for imp in reader.into_imports() {
                let imp = imp?;
                if matches!(imp.ty, wasmparser::TypeRef::Func(_)) {
                    out.push(imp.name.to_string());
                }
            }
        }
    }
    Ok(out)
}

fn import_report(name: &str) -> Result<Value> {
    let code = wasm(name);
    let all = imports(&code)?;
    let batch: Vec<&String> = all.iter().filter(|n| n.starts_with("promise_batch_action_")).collect();
    let scanned: Vec<&&str> = SCANNED.iter().filter(|s| all.iter().any(|n| n == **s)).collect();
    Ok(json!({
        "contract": name,
        "wasm_bytes": code.len(),
        "code_hash": CryptoHash::hash_bytes(&code).to_string(),
        "import_count": all.len(),
        "promise_batch_action_count": batch.len(),
        "promise_batch_action_imports": batch,
        "scanned_imports_present": scanned,
        "all_imports": all,
    }))
}

struct Report {
    name: String,
    rows: Vec<Value>,
}
impl Report {
    fn new(name: &str) -> Self {
        println!("\n================ {name} ================");
        Self { name: name.into(), rows: vec![] }
    }
    fn sent(&mut self, id: &str, what: &str, s: &Sent) {
        println!("[{id}] {what}\n      {}", s.line());
        for l in s.logs() {
            println!("      log: {l}");
        }
        self.rows.push(json!({"id": id, "what": what, "kind": s.kind, "tx_hash": s.tx_hash.to_string(),
            "error": s.error, "logs": s.logs()}));
    }
    fn note(&mut self, id: &str, what: &str, v: Value) {
        println!("[{id}] {what}\n      {v}");
        self.rows.push(json!({"id": id, "what": what, "value": v}));
    }
    fn save(&self) {
        std::fs::create_dir_all(RESULTS).ok();
        let p = format!("{RESULTS}/{}.json", self.name);
        std::fs::write(&p, serde_json::to_string_pretty(&self.rows).unwrap()).unwrap();
        println!("--> saved {p}");
    }
}

struct Lab {
    rpc: Rpc,
    root: Key,
    parent: Key,
}

impl Lab {
    /// Create `id` funded by `by`, with a fresh full-access key, optionally deploying code.
    async fn create(&self, by: &Key, id: &str, bal: u128, code: Option<Vec<u8>>) -> Result<Key> {
        let k = Key::random(id);
        let mut actions = vec![a_create(), a_transfer(near(bal)), a_add_full(k.pk())];
        if let Some(c) = code {
            actions.push(a_deploy(c));
        }
        let s = self.rpc.send(by, &k.id(), actions).await?;
        assert!(s.ok(), "create {id}: {}", s.line());
        Ok(k)
    }

    async fn wait_blocks(&self, n: u64) -> Result<u64> {
        let (_, start) = self.rpc.latest_block().await?;
        loop {
            let (_, h) = self.rpc.latest_block().await?;
            if h >= start + n {
                return Ok(h);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Full-access and function-call key counts plus the raw list.
    async fn keys(&self, id: &AccountId) -> Result<Value> {
        let list = self.rpc.view_access_key_list(id).await?;
        let keys = list["keys"].as_array().cloned().unwrap_or_default();
        let full = keys.iter().filter(|k| k["access_key"]["permission"] == json!("FullAccess")).count();
        Ok(json!({"full_access": full, "function_call": keys.len() - full, "keys": keys}))
    }
}

fn a_add_fc_allowance(pk: near_crypto::PublicKey, allowance: Option<Balance>, receiver: &str, methods: &[&str]) -> Action {
    Action::AddKey(Box::new(AddKeyAction {
        public_key: pk,
        access_key: AccessKey {
            nonce: 0,
            permission: AccessKeyPermission::FunctionCall(FunctionCallPermission {
                allowance,
                receiver_id: receiver.into(),
                method_names: methods.iter().map(|s| s.to_string()).collect(),
            }),
        },
    }))
}
fn a_delete_key(pk: near_crypto::PublicKey) -> Action {
    Action::DeleteKey(Box::new(DeleteKeyAction { public_key: pk }))
}
fn a_use_global(id: GlobalContractIdentifier) -> Action {
    Action::UseGlobalContract(Box::new(UseGlobalContractAction { contract_identifier: id }))
}
fn a_deploy_global(code: Vec<u8>, mode: GlobalContractDeployMode) -> Action {
    Action::DeployGlobalContract(DeployGlobalContractAction { code: code.into(), deploy_mode: mode })
}

#[tokio::main]
async fn main() -> Result<()> {
    let which: Vec<String> = std::env::args().skip(1).collect();
    let all = which.is_empty() || which.iter().any(|w| w == "all");
    let want = |t: &str| all || which.iter().any(|w| w == t);

    let version = std::env::var("SANDBOX_VERSION").unwrap_or(near_sandbox::DEFAULT_NEAR_SANDBOX_VERSION.into());
    println!("starting near-sandbox nearcore {version} ...");
    let sandbox = near_sandbox::Sandbox::start_sandbox_with_version(&version).await?;
    let rpc = Rpc::new(&sandbox.rpc_addr);

    let mut pre = Report::new("owed_preflight");
    let status = rpc.call("status", json!([])).await?.unwrap();
    pre.note("P1", "node version / protocol_version", json!({"version": status["version"],
        "protocol_version": status["protocol_version"], "latest_protocol_version": status["latest_protocol_version"]}));
    pre.save();

    let root = Key::new("sandbox", near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?);
    let parent = Key::random("parent.sandbox");
    let s = rpc.send(&root, &parent.id(), vec![a_create(), a_transfer(near(500)), a_add_full(parent.pk())]).await?;
    assert!(s.ok(), "{}", s.line());
    let lab = Lab { rpc, root, parent };

    if want("t5") {
        t5(&lab).await?;
    }
    if want("t6") {
        t6(&lab).await?;
    }
    if want("t7") || want("t8") {
        t7_t8(&lab, want("t7"), want("t8")).await?;
    }
    if want("t9") {
        t9(&lab).await?;
    }
    Ok(())
}

/// T5: a function-call key on an account bound to a global contract by hash attempts to re-point it.
async fn t5(lab: &Lab) -> Result<()> {
    let mut r = Report::new("owed_t5_fc_key_use_global");
    let v1 = wasm("keymgr");
    let v2 = wasm("fconly");
    let (h1, h2) = (CryptoHash::hash_bytes(&v1), CryptoHash::hash_bytes(&v2));
    let publisher = lab.create(&lab.root, "publisher.sandbox", 100, None).await?;
    let s = lab.rpc.send(&publisher, &publisher.id(), vec![a_deploy_global(v1, GlobalContractDeployMode::CodeHash)]).await?;
    r.sent("T5.0", "publisher: DeployGlobalContract(keymgr, CodeHash)", &s);
    let s = lab.rpc.send(&publisher, &publisher.id(), vec![a_deploy_global(v2, GlobalContractDeployMode::CodeHash)]).await?;
    r.sent("T5.0b", "publisher: DeployGlobalContract(fconly, CodeHash) — the hash an attacker would re-point to", &s);
    let s = lab.rpc.send(&publisher, &publisher.id(), vec![a_deploy_global(wasm("fconly"), GlobalContractDeployMode::AccountId)]).await?;
    r.sent("T5.0c", "publisher: DeployGlobalContract(fconly, AccountId)", &s);

    let user = lab.create(&lab.root, "t5.sandbox", 10, None).await?;
    let agent = Key::random("t5.sandbox");
    let s = lab.rpc.send(&user, &user.id(), vec![
        a_use_global(GlobalContractIdentifier::CodeHash(h1)),
        a_add_fc_allowance(agent.pk(), None, "t5.sandbox", &["spend"]),
    ]).await?;
    r.sent("T5.1", "t5 (full key): [UseGlobalContract(CodeHash keymgr), AddKey(fc: spend on t5)]", &s);
    let s = lab.rpc.send(&user, &user.id(), vec![a_delete_key(user.pk())]).await?;
    r.sent("T5.2", "t5: DeleteKey(own full-access key) — account is now fc-keys only", &s);
    lab.wait_blocks(1).await?;
    r.note("T5.3", "t5 state before attempts", json!({
        "view_account": lab.rpc.view_account(&user.id()).await?, "keys": lab.keys(&user.id()).await?}));

    let s = lab.rpc.send(&agent, &user.id(), vec![a_use_global(GlobalContractIdentifier::CodeHash(h2))]).await?;
    r.sent("T5.4", "fc key: UseGlobalContract(CodeHash fconly) on t5", &s);
    let s = lab.rpc.send(&agent, &user.id(), vec![a_use_global(GlobalContractIdentifier::AccountId(publisher.id()))]).await?;
    r.sent("T5.5", "fc key: UseGlobalContract(AccountId publisher) on t5", &s);
    let s = lab.rpc.send(&agent, &user.id(), vec![a_call("spend", json!({}), tgas(10), yocto(0))]).await?;
    r.sent("T5.6", "control: fc key calls spend on t5", &s);
    lab.wait_blocks(1).await?;
    r.note("T5.7", "t5 state after attempts (global_contract_hash must still be keymgr)", json!({
        "expected_global_contract_hash": h1.to_string(), "view_account": lab.rpc.view_account(&user.id()).await?}));
    r.save();
    Ok(())
}

/// T6: a classic function-call key with an allowance, on a contract account, until the allowance runs out.
async fn t6(lab: &Lab) -> Result<()> {
    let mut r = Report::new("owed_t6_allowance");
    let acct = lab.create(&lab.root, "t6.sandbox", 20, Some(wasm("keymgr"))).await?;
    let agent = Key::random("t6.sandbox");
    let allowance = millinear(50);
    let s = lab.rpc.send(&acct, &acct.id(), vec![a_add_fc_allowance(agent.pk(), Some(allowance), "t6.sandbox", &["spend"])]).await?;
    r.sent("T6.0", "t6: AddKey(fc: spend, allowance 0.05 NEAR)", &s);

    let allowance_of = |v: &Value| -> Option<u128> {
        v["permission"]["FunctionCall"]["allowance"].as_str().and_then(|s| s.parse().ok())
    };
    let balance_of = |v: &Value| -> u128 { v["amount"].as_str().unwrap().parse().unwrap() };
    let mut calls = vec![];
    let mut last_err = Value::Null;
    for i in 0..200 {
        let before_key = lab.rpc.view_access_key(&acct.id(), &agent.pk()).await?;
        let before_bal = balance_of(&lab.rpc.view_account(&acct.id()).await?);
        let s = lab.rpc.send(&agent, &acct.id(), vec![a_call("spend", json!({}), tgas(30), yocto(0))]).await?;
        if !s.ok() {
            r.sent("T6.exhausted", &format!("call #{i} with the allowance nearly spent"), &s);
            last_err = s.error.clone();
            break;
        }
        let after_key = lab.rpc.view_access_key(&acct.id(), &agent.pk()).await?;
        let after_bal = balance_of(&lab.rpc.view_account(&acct.id()).await?);
        calls.push(json!({
            "call": i,
            "allowance_before": allowance_of(&before_key).map(|a| a.to_string()),
            "allowance_after": allowance_of(&after_key).map(|a| a.to_string()),
            "allowance_drawn": match (allowance_of(&before_key), allowance_of(&after_key)) {
                (Some(b), Some(a)) => Some((b - a).to_string()), _ => None },
            "account_balance_drawn": before_bal.saturating_sub(after_bal).to_string(),
        }));
    }
    r.note("T6.1", "per-call allowance and account balance drawn (30 Tgas prepaid each)", json!({
        "allowance_yocto": allowance.as_yoctonear().to_string(), "successful_calls": calls.len(),
        "calls": calls, "error_at_exhaustion": last_err}));
    r.save();
    Ok(())
}

/// T7: a contract with no full-access key manages its own function-call keys by promise; compiled imports.
/// T8: an agent key restricted to `spend` attempts a `cb_` method.
async fn t7_t8(lab: &Lab, do_t7: bool, do_t8: bool) -> Result<()> {
    let mut r7 = Report::new("owed_t7_self_key_management");
    let acct = lab.create(&lab.root, "t7.sandbox", 20, Some(wasm("keymgr"))).await?;
    let s = lab.rpc.send(&acct, &acct.id(), vec![a_delete_key(acct.pk())]).await?;
    r7.sent("T7.0", "t7 (keymgr): DeleteKey(own full-access key)", &s);
    lab.wait_blocks(1).await?;
    r7.note("T7.1", "t7 keys with no full-access key", lab.keys(&acct.id()).await?);

    let agent = Key::random("t7.sandbox");
    let s = lab.rpc.send(&lab.root, &acct.id(), vec![a_call("add_fc_key",
        json!({"public_key": agent.pk().to_string(), "methods": "spend"}), tgas(30), yocto(0))]).await?;
    r7.sent("T7a.0", "t7.add_fc_key(agent, spend) — contract adds a fc key to itself by low-level promise", &s);
    lab.wait_blocks(1).await?;
    r7.note("T7a.1", "t7 keys after add", lab.keys(&acct.id()).await?);

    if do_t8 {
        let mut r8 = Report::new("owed_t8_callback_methods");
        let s = lab.rpc.send(&agent, &acct.id(), vec![a_call("spend", json!({}), tgas(10), yocto(0))]).await?;
        r8.sent("T8.0", "control: agent key calls spend", &s);
        let s = lab.rpc.send(&agent, &acct.id(), vec![a_call("cb_settle", json!({}), tgas(10), yocto(0))]).await?;
        r8.sent("T8.1", "agent key (method_names [spend]) calls cb_settle", &s);
        r8.save();
    }

    // A deleted key has no nonce to query, so remember it now and sign the later attempt by hand.
    let agent_nonce = lab.rpc.next_nonce(&agent).await?;
    let s = lab.rpc.send(&lab.root, &acct.id(), vec![a_call("delete_key",
        json!({"public_key": agent.pk().to_string()}), tgas(30), yocto(0))]).await?;
    r7.sent("T7a.2", "t7.delete_key(agent) — contract deletes its own fc key", &s);
    lab.wait_blocks(1).await?;
    r7.note("T7a.3", "t7 keys after delete", lab.keys(&acct.id()).await?);
    let (block_hash, _) = lab.rpc.latest_block().await?;
    let tx = near_primitives::transaction::Transaction::V0(near_primitives::transaction::TransactionV0 {
        signer_id: agent.id(), public_key: agent.pk(), nonce: agent_nonce, receiver_id: acct.id(), block_hash,
        actions: vec![a_call("spend", json!({}), tgas(10), yocto(0))],
    });
    let s = lab.rpc.submit(&sign(tx, &agent.signer), "FINAL").await?;
    r7.sent("T7a.4", "deleted agent key calls spend (signed with its last nonce)", &s);

    let fc = lab.create(&lab.root, "t7b.sandbox", 20, Some(wasm("fconly"))).await?;
    let s = lab.rpc.send(&fc, &fc.id(), vec![a_delete_key(fc.pk())]).await?;
    r7.sent("T7b.0", "t7b (fconly): DeleteKey(own full-access key)", &s);
    r7.note("T7b.1", "fconly imports: the only key-adding host function it can call", import_report("fconly")?);
    let k = Key::random("t7b.sandbox");
    let s = lab.rpc.send(&lab.root, &fc.id(), vec![a_call("add_fc_key",
        json!({"public_key": k.pk().to_string(), "method": ""}), tgas(30), yocto(0))]).await?;
    r7.sent("T7b.2", "t7b.add_fc_key(k, method \"\") — widest key fconly can create", &s);
    lab.wait_blocks(1).await?;
    r7.note("T7b.3", "t7b keys: still no full-access key", lab.keys(&fc.id()).await?);

    if do_t7 {
        r7.note("T7c.keymgr", "low-level build (cargo near build)", import_report("keymgr")?);
        r7.note("T7c.keymgr_promise", "Promise build (cargo near build)", import_report("keymgr_promise")?);
    }
    r7.save();
    Ok(())
}

/// T9: a contract able to delete its own account; can the parent recreate the name with other code?
async fn t9(lab: &Lab) -> Result<()> {
    let mut r = Report::new("owed_t9_delete_recreate");
    let child_id: AccountId = "child.parent.sandbox".parse()?;
    let child = lab.create(&lab.parent, child_id.as_str(), 10, Some(wasm("keymgr"))).await?;
    let s = lab.rpc.send(&child, &child_id, vec![a_delete_key(child.pk())]).await?;
    r.sent("T9.0", "child (keymgr, imports delete_account): DeleteKey(own full-access key)", &s);
    lab.wait_blocks(1).await?;
    r.note("T9.1", "child before: view_account / keys / imports", json!({
        "view_account": lab.rpc.view_account(&child_id).await?, "keys": lab.keys(&child_id).await?,
        "scanned_imports_present": import_report("keymgr")?["scanned_imports_present"]}));

    let s = lab.rpc.send(&lab.root, &child_id, vec![a_call("delete_self",
        json!({"beneficiary": lab.parent.id()}), tgas(30), yocto(0))]).await?;
    r.sent("T9.2", "anyone calls child.delete_self(parent)", &s);
    lab.wait_blocks(1).await?;
    r.note("T9.3", "child after delete", json!({"view_account": lab.rpc.view_account(&child_id).await.map_err(|e| e.to_string()).err()}));

    let new_key = Key::random(child_id.as_str());
    let s = lab.rpc.send(&lab.parent, &child_id, vec![a_create(), a_transfer(near(5)), a_add_full(new_key.pk()), a_deploy(wasm("fconly"))]).await?;
    r.sent("T9.4", "parent recreates child.parent.sandbox with a full-access key and other code (fconly)", &s);
    lab.wait_blocks(1).await?;
    r.note("T9.5", "child after recreate", json!({
        "view_account": lab.rpc.view_account(&child_id).await.ok(), "keys": lab.keys(&child_id).await.ok(),
        "version": lab.rpc.view_call(&child_id, "version", json!({})).await.ok()}));

    let s = lab.rpc.send(&lab.root, &"other.sandbox".parse()?, vec![a_create(), a_transfer(near(1))]).await?;
    r.sent("T9.6", "control: root creates a fresh top-level name (root is the parent of *.sandbox)", &s);
    let stranger = lab.create(&lab.root, "stranger.sandbox", 10, None).await?;
    let s = lab.rpc.send(&stranger, &"child2.parent.sandbox".parse()?, vec![a_create(), a_transfer(near(1))]).await?;
    r.sent("T9.7", "control: a non-parent tries to create a sub-account of parent.sandbox", &s);
    r.save();
    Ok(())
}
