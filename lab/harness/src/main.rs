//! Renkarna protocol validation harness: T0–T4 against a local nearcore sandbox.
//!
//! Usage: cargo run -p harness --release -- [t0|t1|t2|t3|t4|all]
//! Results: printed + written to lab/results/<test>.json

mod rpc;

use anyhow::Result;
use near_primitives::action::delegate::{DelegateActionV2, NonDelegateAction, VersionedSignedDelegateAction};
use near_primitives::action::{
    Action, DeployGlobalContractAction, GlobalContractDeployMode, GlobalContractIdentifier, UseGlobalContractAction,
};
use near_primitives::hash::CryptoHash;
use near_primitives::transaction::TransactionNonce;
use rpc::*;
use serde_json::{json, Value};
use std::time::Duration;

const WASM_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../target/near");
const RESULTS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../results");

fn wasm(name: &str) -> Vec<u8> {
    let p = match name {
        "target_v1" | "target_v2" => format!("{WASM_DIR}/target/{name}.wasm"),
        n => format!("{WASM_DIR}/{n}/{n}.wasm"),
    };
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e} (build contracts first)"))
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

    let mut pre = Report::new("preflight");
    let status = rpc.call("status", json!([])).await?.unwrap();
    pre.note("P1", "node version / protocol_version", json!({"version": status["version"],
        "protocol_version": status["protocol_version"], "latest_protocol_version": status["latest_protocol_version"]}));
    pre.save();

    let root = Key::new("sandbox", near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?);
    let parent = Key::random("parent.sandbox");
    let s = rpc.send(&root, &parent.id(), vec![a_create(), a_transfer(near(500)), a_add_full(parent.pk())]).await?;
    assert!(s.ok(), "{}", s.line());
    let lab = Lab { rpc, root, parent };

    let gate = lab.create(&lab.root, "gate.sandbox", 20, Some(wasm("gate"))).await?;
    let target = lab.create(&lab.root, "target.sandbox", 20, Some(wasm("target_v1"))).await?;
    let usdc = lab.create(&lab.root, "usdc.sandbox", 20, Some(wasm("usdc"))).await?;
    let funder = lab.create(&lab.root, "funder.sandbox", 50, Some(wasm("funder"))).await?;
    let s = lab.rpc.send(&usdc, &usdc.id(), vec![a_call("new", json!({}), tgas(10), yocto(0))]).await?;
    assert!(s.ok(), "{}", s.line());

    // T1a (literal): balance set inside AddKey
    let agent0 = Key::random("agent-0.parent.sandbox");
    let mut t1 = Report::new("t1_gas_key_funding");
    let s = lab
        .rpc
        .send(&lab.parent, &agent0.id(), vec![
            a_create(),
            a_add_gas_fc(agent0.pk(), near(1), 4, "gate.sandbox", &["execute"]),
            a_transfer(millinear(100)),
        ])
        .await?;
    t1.sent("T1a", "parent: [CreateAccount, AddKey(GasKeyFunctionCall balance=1N nonces=4 -> gate.execute), Transfer 0.1N]", &s);

    // T1a-alt: zero-balance gas key + TransferToGasKey inside the creation batch. This becomes agent-1.
    let agent = Key::random("agent-1.parent.sandbox");
    let parent_before = bal(&lab, &lab.parent.id()).await?;
    let s = lab
        .rpc
        .send(&lab.parent, &agent.id(), vec![
            a_create(),
            a_transfer(millinear(100)),
            a_add_gas_fc(agent.pk(), yocto(0), 4, "gate.sandbox", &["execute"]),
            a_to_gas_key(agent.pk(), near(1)),
        ])
        .await?;
    t1.sent("T1a-alt", "parent: [CreateAccount, Transfer 0.1N, AddKey(gas key balance=0), TransferToGasKey 1N] in one batch", &s);
    let agent_ok = s.ok();
    if agent_ok {
        let parent_after = bal(&lab, &lab.parent.id()).await?;
        t1.note("T1a-alt.balance", "agent-1 after creation",
            json!({"gas_key_balance_yocto": lab.rpc.gas_key_balance(&agent.id(), &agent.pk()).await?.to_string(),
                   "parent_spent_yocto": (parent_before - parent_after).to_string(),
                   "agent_keys": lab.rpc.view_access_key_list(&agent.id()).await?,
                   "gas_key_nonces": lab.rpc.view_gas_key_nonces(&agent.id(), &agent.pk()).await?}));
    }

    // T1a-contract: factory contract creates + funds agent in one promise batch
    let agent3 = Key::random("agent-3.funder.sandbox");
    let s = lab
        .rpc
        .send(&lab.parent, &funder.id(), vec![a_call("create_agent", json!({"name":"agent-3","public_key":agent3.pk().to_string(),
            "gas_amount": near(1).as_yoctonear().to_string(), "receiver_id":"gate.sandbox","method_names":"execute"}), tgas(100), yocto(0))])
        .await?;
    t1.sent("T1a-contract", "funder.create_agent: promise batch [CreateAccount, Transfer, AddGasKey(FC), TransferToGasKey] (predecessor=funder)", &s);
    if s.ok() {
        t1.note("T1a-contract.balance", "agent-3 gas key", lab.rpc.view_access_key(&agent3.id(), &agent3.pk()).await?);
    }

    if agent_ok {
        // T1b: parent tops up agent's gas key after creation
        let before = lab.rpc.gas_key_balance(&agent.id(), &agent.pk()).await?;
        let s = lab.rpc.send(&lab.parent, &agent.id(), vec![a_to_gas_key(agent.pk(), millinear(500))]).await?;
        t1.sent("T1b", "parent signs TransferToGasKey(agent-1 gas key, 0.5N), receiver=agent-1", &s);
        let after = lab.rpc.gas_key_balance(&agent.id(), &agent.pk()).await?;
        t1.note("T1b.delta", "agent-1 gas key balance before/after", json!({"before": before.to_string(), "after": after.to_string()}));

        // T1b-unrelated: a non-parent account tries the same
        let s = lab.rpc.send(&usdc, &agent.id(), vec![a_to_gas_key(agent.pk(), millinear(500))]).await?;
        t1.sent("T1b-3rdparty-tx", "usdc.sandbox (unrelated full-key account) signs TransferToGasKey to agent-1", &s);

        // T1c: third-party contract via promise_batch_action_transfer_to_gas_key
        let before = lab.rpc.gas_key_balance(&agent.id(), &agent.pk()).await?;
        let s = lab
            .rpc
            .send(&lab.parent, &funder.id(), vec![a_call("fund", json!({"account_id": agent.id(), "public_key": agent.pk().to_string(),
                "amount": millinear(500).as_yoctonear().to_string()}), tgas(50), yocto(0))])
            .await?;
        t1.sent("T1c", "funder.fund -> Promise(agent-1).transfer_to_gas_key(pk, 0.5N)", &s);
        let after = lab.rpc.gas_key_balance(&agent.id(), &agent.pk()).await?;
        t1.note("T1c.delta", "agent-1 gas key balance before/after", json!({"before": before.to_string(), "after": after.to_string()}));

        // T1d: DelegateV2 meta-tx, agent as sender, signed by its gas key, relayed by parent
        for (label, inner) in [
            ("T1d", a_to_gas_key(agent.pk(), millinear(10))),
            ("T1d-control", a_call("execute", json!({"target":"target.sandbox"}), tgas(30), yocto(0))),
        ] {
            let receiver = if label == "T1d" { agent.id() } else { gate.id() };
            let nonce = lab.rpc.next_gas_nonce(&agent, 1).await?;
            let (_, h) = lab.rpc.latest_block().await?;
            let da = DelegateActionV2 {
                sender_id: agent.id(),
                receiver_id: receiver.clone(),
                actions: vec![NonDelegateAction::try_from(inner).unwrap()],
                nonce: TransactionNonce::from_nonce_and_index(nonce, 1),
                max_block_height: h + 100,
                public_key: agent.pk(),
            };
            let sda = VersionedSignedDelegateAction::sign(&agent.signer, da.into());
            let s = lab.rpc.send(&lab.parent, &agent.id(), vec![Action::DelegateV2(Box::new(sda))]).await?;
            let what = if label == "T1d" {
                "DelegateV2{sender=agent-1, signed by gas key idx1, [TransferToGasKey]} relayed by parent"
            } else {
                "DelegateV2{sender=agent-1, receiver=gate, [FunctionCall execute]} relayed by parent (control: allowed action)"
            };
            t1.sent(label, what, &s);
        }

        // Depletion rate: N gate.execute calls via the gas key
        let n = 10;
        let b0 = lab.rpc.gas_key_balance(&agent.id(), &agent.pk()).await?;
        let acct0 = bal(&lab, &agent.id()).await?;
        let mut burnt_total: u128 = 0;
        for i in 0..n {
            let s = lab.rpc.send_gas(&agent, (i % 4) as u16, &gate.id(), vec![a_call("execute", json!({"target":"target.sandbox"}), tgas(30), yocto(0))]).await?;
            assert!(s.ok(), "execute #{i}: {}", s.line());
            burnt_total += tokens_burnt(&s.raw);
        }
        let b1 = lab.rpc.gas_key_balance(&agent.id(), &agent.pk()).await?;
        let acct1 = bal(&lab, &agent.id()).await?;
        let per_call = (b0 - b1) / n as u128;
        t1.note("T1.depletion", &format!("{n}x gate.execute (prepaid 30 Tgas each) via gas key"), json!({
            "gas_key_before": b0.to_string(), "gas_key_after": b1.to_string(),
            "net_cost_per_call_yocto": per_call.to_string(),
            "net_cost_per_call_near": per_call as f64 / 1e24,
            "calls_per_1_NEAR": (1e24 / per_call as f64).floor(),
            "sum_tokens_burnt_all_receipts_yocto": burnt_total.to_string(),
            "agent_account_balance_before": acct0.to_string(), "agent_account_balance_after": acct1.to_string(),
        }));

        // Can sponsored gas-key funds ever come back out?
        let w = |amt| Action::WithdrawFromGasKey(Box::new(near_primitives::action::WithdrawFromGasKeyAction { public_key: agent.pk(), amount: amt }));
        let s = lab.rpc.send(&lab.parent, &agent.id(), vec![w(millinear(100))]).await?;
        t1.sent("T1.withdraw-parent", "parent signs WithdrawFromGasKey(agent-1 gas key, 0.1N)", &s);
        let s = lab.rpc.send_gas(&agent, 2, &agent.id(), vec![w(millinear(100))]).await?;
        t1.sent("T1.withdraw-self", "agent-1 gas key signs WithdrawFromGasKey on itself", &s);

        // What does exhaustion look like?
        let poor = Key::random("agent-poor.parent.sandbox");
        let s = lab.rpc.send(&lab.parent, &poor.id(), vec![a_create(), a_transfer(millinear(100)), a_add_gas_fc(poor.pk(), yocto(0), 1, "gate.sandbox", &["execute"]), a_to_gas_key(poor.pk(), yocto(1))]).await?;
        assert!(s.ok(), "{}", s.line());
        let s = lab.rpc.send_gas(&poor, 0, &gate.id(), vec![a_call("execute", json!({"target":"target.sandbox"}), tgas(30), yocto(0))]).await?;
        t1.sent("T1.exhausted", "gas key with 1 yocto balance calls gate.execute (account itself holds 0.1N)", &s);
    }
    t1.save();

    if want("t0") && agent_ok {
        let mut t0 = Report::new("t0_agent_isolation");
        let g = |acts: Vec<Action>, recv: &str| (acts, recv.to_string());
        let cases = vec![
            ("T0.1", "agent gas key: Transfer 1 yocto -> parent", g(vec![a_transfer(yocto(1))], "parent.sandbox")),
            ("T0.2", "agent gas key: AddKey(FullAccess) on itself", g(vec![a_add_full(Key::random("x.sandbox").pk())], "agent-1.parent.sandbox")),
            ("T0.3", "agent gas key: DeployContract on itself", g(vec![a_deploy(wasm("target_v1"))], "agent-1.parent.sandbox")),
            ("T0.4", "agent gas key: FunctionCall usdc.ft_balance_of (receiver != gate)", g(vec![a_call("ft_balance_of", json!({"account_id":"x"}), tgas(10), yocto(0))], "usdc.sandbox")),
            ("T0.5", "agent gas key: FunctionCall gate.other (method not in method_names)", g(vec![a_call("other", json!({}), tgas(10), yocto(0))], "gate.sandbox")),
        ];
        for (id, what, (acts, recv)) in cases {
            let s = lab.rpc.send_gas(&agent, 0, &recv.parse()?, acts).await?;
            t0.sent(id, what, &s);
        }
        let s = lab.rpc.send(&lab.parent, &agent.id(), vec![a_add_full(Key::random("x.sandbox").pk())]).await?;
        t0.sent("T0.6", "parent (full key) signs AddKey(FullAccess) with receiver=agent-1", &s);
        let s = lab.rpc.send(&lab.parent, &agent.id(), vec![a_deploy(wasm("target_v1"))]).await?;
        t0.sent("T0.6b", "parent (full key) signs DeployContract with receiver=agent-1", &s);
        let s = lab.rpc.send(&lab.parent, &agent.id(), vec![Action::DeleteAccount(near_primitives::action::DeleteAccountAction { beneficiary_id: lab.parent.id() })]).await?;
        t0.sent("T0.6c", "parent (full key) signs DeleteAccount with receiver=agent-1", &s);
        let s = lab.rpc.send_gas(&agent, 0, &gate.id(), vec![a_call("execute", json!({"target":"target.sandbox"}), tgas(30), yocto(0))]).await?;
        t0.sent("T0.ok", "control: agent gas key -> gate.execute (allowed)", &s);
        t0.note("T0.keys", "agent-1 final access key list", lab.rpc.view_access_key_list(&agent.id()).await?);
        t0.save();
    }

    if want("t4") {
        let mut t4 = Report::new("t4_deposit_restricted_keys");
        // regular FC keys on a separate agent (scoped to gate and to usdc)
        let fc_gate = Key::random("agent-fc.parent.sandbox");
        let fc_usdc = Key::new("agent-fc.parent.sandbox", near_crypto::SecretKey::from_random(near_crypto::KeyType::ED25519));
        let s = lab.rpc.send(&lab.parent, &fc_gate.id(), vec![a_create(), a_transfer(near(1)),
            a_add_fc(fc_gate.pk(), "gate.sandbox", &["execute"]), a_add_fc(fc_usdc.pk(), "usdc.sandbox", &["ft_transfer"])]).await?;
        assert!(s.ok(), "{}", s.line());
        // gas FC key scoped to usdc
        let gk_usdc = Key::random("agent-usdc.parent.sandbox");
        let s = lab.rpc.send(&lab.parent, &gk_usdc.id(), vec![a_create(), a_transfer(near(1)),
            a_add_gas_fc(gk_usdc.pk(), yocto(0), 2, "usdc.sandbox", &["ft_transfer"]), a_to_gas_key(gk_usdc.pk(), near(1))]).await?;
        assert!(s.ok(), "{}", s.line());
        for who in [fc_gate.id(), gk_usdc.id()] {
            let s = lab.rpc.send(&usdc, &usdc.id(), vec![a_call("mint", json!({"account_id": who, "amount":"1000000"}), tgas(10), yocto(0))]).await?;
            assert!(s.ok());
        }
        let exec = |d| a_call("execute", json!({"target":"target.sandbox"}), tgas(30), d);
        let ft = |d| a_call("ft_transfer", json!({"receiver_id":"parent.sandbox","amount":"1"}), tgas(30), d);

        let s = lab.rpc.send(&fc_gate, &gate.id(), vec![exec(yocto(1))]).await?;
        t4.sent("T4.1", "regular FunctionCall key -> gate.execute with deposit 1 yocto", &s);
        if agent_ok {
            let s = lab.rpc.send_gas(&agent, 0, &gate.id(), vec![exec(yocto(1))]).await?;
            t4.sent("T4.2", "GasKeyFunctionCall key -> gate.execute with deposit 1 yocto", &s);
        }
        let s = lab.rpc.send(&fc_usdc, &usdc.id(), vec![ft(yocto(1))]).await?;
        t4.sent("T4.3", "regular FC key scoped to usdc.ft_transfer, deposit 1 yocto (NEP-141 requirement)", &s);
        let s = lab.rpc.send(&fc_usdc, &usdc.id(), vec![ft(yocto(0))]).await?;
        t4.sent("T4.4", "regular FC key scoped to usdc.ft_transfer, deposit 0", &s);
        let s = lab.rpc.send_gas(&gk_usdc, 0, &usdc.id(), vec![ft(yocto(1))]).await?;
        t4.sent("T4.5", "gas FC key scoped to usdc.ft_transfer, deposit 1 yocto", &s);
        let s = lab.rpc.send_gas(&gk_usdc, 0, &usdc.id(), vec![ft(yocto(0))]).await?;
        t4.sent("T4.6", "gas FC key scoped to usdc.ft_transfer, deposit 0", &s);
        t4.note("T4.balances", "usdc balances after (agent-fc, agent-usdc)", json!([
            lab.rpc.view_call(&usdc.id(), "ft_balance_of", json!({"account_id": fc_gate.id()})).await?,
            lab.rpc.view_call(&usdc.id(), "ft_balance_of", json!({"account_id": gk_usdc.id()})).await?]));
        t4.save();
    }

    if want("t2") {
        t2(&lab, &gate, &target).await?;
    }
    if want("t3") {
        t3(&lab).await?;
    }
    if want("t5") {
        t5(&lab).await?;
    }
    drop(sandbox);
    Ok(())
}

async fn bal(lab: &Lab, id: &near_primitives::types::AccountId) -> Result<u128> {
    Ok(lab.rpc.view_account(id).await?["amount"].as_str().unwrap().parse()?)
}

fn tokens_burnt(raw: &Value) -> u128 {
    let mut t: u128 = raw["transaction_outcome"]["outcome"]["tokens_burnt"].as_str().unwrap_or("0").parse().unwrap_or(0);
    for r in raw["receipts_outcome"].as_array().into_iter().flatten() {
        t += r["outcome"]["tokens_burnt"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0);
    }
    t
}

/// Map each receipt to (executor, block height, logs, status) for timeline reporting.
async fn timeline(lab: &Lab, s: &Sent) -> Result<Value> {
    let mut out = vec![];
    if let Some(bh) = s.raw["transaction_outcome"]["block_hash"].as_str() {
        out.push(json!({"step":"tx included (converted to receipt)", "height": lab.rpc.height_of(bh).await?}));
    }
    for r in s.raw["receipts_outcome"].as_array().into_iter().flatten() {
        let h = lab.rpc.height_of(r["block_hash"].as_str().unwrap()).await?;
        out.push(json!({"executor": r["outcome"]["executor_id"], "height": h, "logs": r["outcome"]["logs"],
            "status": r["outcome"]["status"].as_object().and_then(|o| o.keys().next().cloned())}));
    }
    Ok(json!(out))
}

async fn t2(lab: &Lab, gate: &Key, target: &Key) -> Result<()> {
    let mut r = Report::new("t2_toctou_window");
    let v1 = wasm("target_v1");
    let v2 = wasm("target_v2");
    let caller = &lab.parent; // who signs gate.execute does not matter for the race

    // Scenarios: offset (in blocks) between gate.execute submission and the deploy submission.
    // negative = deploy submitted first.
    for (label, offset, via_promise) in [
        ("same-block direct DeployContract", 0i64, false),
        ("deploy 1 block after gate tx", 1, false),
        ("deploy 2 blocks after gate tx", 2, false),
        ("deploy 3 blocks after gate tx", 3, false),
        ("same-block self_upgrade (promise hop)", 0, true),
    ] {
        // reset to v1
        let s = lab.rpc.send(target, &target.id(), vec![a_deploy(v1.clone())]).await?;
        assert!(s.ok());
        lab.wait_blocks(2).await?;
        let (_, h_check) = lab.rpc.latest_block().await?;
        let observed = lab.rpc.view_code_hash(&target.id()).await?;

        let gate_tx = lab.rpc.build(caller, &gate.id(), vec![a_call("execute", json!({"target": target.id()}), tgas(50), yocto(0))]).await?;
        let dep_actions = if via_promise {
            vec![a_call_raw("self_upgrade", borsh::to_vec(&v2)?, tgas(100), yocto(0))]
        } else {
            vec![a_deploy(v2.clone())]
        };
        let dep_tx = lab.rpc.build(target, &target.id(), dep_actions).await?;

        if offset == 0 {
            let (a, b) = tokio::join!(lab.rpc.submit(&gate_tx, "NONE"), lab.rpc.submit(&dep_tx, "NONE"));
            a?; b?;
        } else {
            lab.rpc.submit(&gate_tx, "NONE").await?;
            lab.wait_blocks(offset as u64).await?;
            lab.rpc.submit(&dep_tx, "NONE").await?;
        }
        let g = lab.rpc.tx_status(&gate_tx.get_hash(), &caller.id()).await?;
        let d = lab.rpc.tx_status(&dep_tx.get_hash(), &target.id()).await?;
        let observed_version = g.logs().iter().find_map(|l| l.strip_prefix("gate.on_version ").map(String::from));
        r.note(&format!("T2[{label}]"), "attestor checked code hash, then race", json!({
            "attestor_check_height": h_check,
            "attestor_saw_code_hash": observed["hash"],
            "gate_tx": g.tx_hash.to_string(), "gate_timeline": timeline(lab, &g).await?,
            "deploy_tx": d.tx_hash.to_string(), "deploy_timeline": timeline(lab, &d).await?,
            "gate_callback": observed_version,
            "code_hash_now": lab.rpc.view_code_hash(&target.id()).await?["hash"],
        }));
    }
    r.save();
    Ok(())
}

async fn t3(lab: &Lab) -> Result<()> {
    let mut r = Report::new("t3_global_contract_hash_tracking");
    let v1 = wasm("target_v1");
    let v2 = wasm("target_v2");
    let h1 = CryptoHash::hash_bytes(&v1);
    let h2 = CryptoHash::hash_bytes(&v2);
    r.note("T3.hashes", "sha256 of wasm (CryptoHash)", json!({"v1": h1.to_string(), "v2": h2.to_string()}));

    // ---- Path A: by account id ----
    let owner = lab.create(&lab.root, "owner.sandbox", 100, None).await?;
    let s = lab.rpc.send(&owner, &owner.id(), vec![Action::DeployGlobalContract(DeployGlobalContractAction {
        code: v1.clone().into(), deploy_mode: GlobalContractDeployMode::AccountId })]).await?;
    r.sent("T3A.0", "owner: DeployGlobalContract(v1, mode=AccountId)", &s);
    let user_a = lab.create(&lab.root, "user-a.sandbox", 10, None).await?;
    let s = lab.rpc.send(&user_a, &user_a.id(), vec![Action::UseGlobalContract(Box::new(UseGlobalContractAction {
        contract_identifier: GlobalContractIdentifier::AccountId(owner.id()) }))]).await?;
    r.sent("T3A.1", "user-a: UseGlobalContract(AccountId(owner))", &s);
    lab.wait_blocks(2).await?;

    let snap = |label: &'static str| async move {
        let acct = lab.rpc.view_account(&"user-a.sandbox".parse().unwrap()).await.map_err(|e| e.to_string());
        let code = lab.rpc.view_code_hash(&"user-a.sandbox".parse().unwrap()).await.map_err(|e| e.to_string());
        let ver = lab.rpc.view_call(&"user-a.sandbox".parse().unwrap(), "version", json!({})).await.map_err(|e| e.to_string());
        json!({"label": label, "view_account": acct.ok(), "view_code": code.ok(), "version_view_call": ver})
    };
    r.note("T3A.2", "BEFORE owner redeploy: view_account / view_code / version()", snap("before").await);
    let s = lab.rpc.send(&user_a, &"user-a.sandbox".parse()?, vec![a_call("version", json!({}), tgas(10), yocto(0))]).await?;
    r.sent("T3A.2tx", "user-a.version() as transaction (before)", &s);

    let s = lab.rpc.send(&owner, &owner.id(), vec![Action::DeployGlobalContract(DeployGlobalContractAction {
        code: v2.clone().into(), deploy_mode: GlobalContractDeployMode::AccountId })]).await?;
    r.sent("T3A.3", "owner: DeployGlobalContract(v2, mode=AccountId) — no tx touches user-a", &s);
    let deploy_h = lab.rpc.height_of(s.raw["transaction_outcome"]["block_hash"].as_str().unwrap()).await?;
    // poll until user-a executes v2 to measure propagation
    let mut switched_at = None;
    for _ in 0..50 {
        let (_, h) = lab.rpc.latest_block().await?;
        if lab.rpc.view_call(&user_a.id(), "version", json!({})).await.ok().as_deref() == Some("\"v2\"") {
            switched_at = Some(h);
            break;
        }
        lab.wait_blocks(1).await?;
    }
    r.note("T3A.4", "propagation", json!({"global_redeploy_tx_height": deploy_h, "user_a_runs_v2_at_height": switched_at}));
    r.note("T3A.5", "AFTER owner redeploy: view_account / view_code / version()", snap("after").await);
    let s = lab.rpc.send(&user_a, &user_a.id(), vec![a_call("version", json!({}), tgas(10), yocto(0))]).await?;
    r.sent("T3A.5tx", "user-a.version() as transaction (after)", &s);

    // ---- Path B: by code hash ----
    let pub_b = lab.create(&lab.root, "publisher.sandbox", 100, None).await?;
    let s = lab.rpc.send(&pub_b, &pub_b.id(), vec![Action::DeployGlobalContract(DeployGlobalContractAction {
        code: v2.clone().into(), deploy_mode: GlobalContractDeployMode::CodeHash })]).await?;
    r.sent("T3B.0", "publisher: DeployGlobalContract(v2, mode=CodeHash)", &s);
    let s = lab.rpc.send(&pub_b, &pub_b.id(), vec![Action::DeployGlobalContract(DeployGlobalContractAction {
        code: v1.clone().into(), deploy_mode: GlobalContractDeployMode::CodeHash })]).await?;
    r.sent("T3B.0b", "publisher: DeployGlobalContract(v1, mode=CodeHash) (second blob, different hash)", &s);
    let user_b = lab.create(&lab.root, "user-b.sandbox", 10, None).await?;
    let s = lab.rpc.send(&user_b, &user_b.id(), vec![Action::UseGlobalContract(Box::new(UseGlobalContractAction {
        contract_identifier: GlobalContractIdentifier::CodeHash(h2) }))]).await?;
    r.sent("T3B.1", "user-b: UseGlobalContract(CodeHash(v2))", &s);
    lab.wait_blocks(2).await?;
    let ub: near_primitives::types::AccountId = "user-b.sandbox".parse()?;
    r.note("T3B.2", "user-b view_account / view_code / version()", json!({
        "view_account": lab.rpc.view_account(&ub).await?, "view_code": lab.rpc.view_code_hash(&ub).await?,
        "version": lab.rpc.view_call(&ub, "version", json!({})).await?}));
    // The account binding is NOT immutable if the account holds a full-access key:
    let s = lab.rpc.send(&user_b, &user_b.id(), vec![Action::UseGlobalContract(Box::new(UseGlobalContractAction {
        contract_identifier: GlobalContractIdentifier::CodeHash(h1) }))]).await?;
    r.sent("T3B.3", "user-b (has full key) re-points to CodeHash(v1)", &s);
    lab.wait_blocks(1).await?;
    r.note("T3B.4", "user-b after re-point", json!({"view_account": lab.rpc.view_account(&ub).await?,
        "version": lab.rpc.view_call(&ub, "version", json!({})).await?}));

    // Locked variant: account with NO keys bound by hash
    let uc: near_primitives::types::AccountId = "user-c.sandbox".parse()?;
    let s = lab.rpc.send(&lab.root, &uc, vec![a_create(), a_transfer(near(5)),
        Action::UseGlobalContract(Box::new(UseGlobalContractAction { contract_identifier: GlobalContractIdentifier::CodeHash(h1) }))]).await?;
    r.sent("T3C.0", "user-c: [CreateAccount, Transfer, UseGlobalContract(CodeHash v1)] — no keys added (locked)", &s);
    lab.wait_blocks(1).await?;
    r.note("T3C.1", "user-c locked: keys / view_account / version", json!({
        "keys": lab.rpc.view_access_key_list(&uc).await?, "view_account": lab.rpc.view_account(&uc).await?,
        "version": lab.rpc.view_call(&uc, "version", json!({})).await?}));
    let s = lab.rpc.send(&lab.parent, &uc, vec![a_call_raw("self_upgrade", borsh::to_vec(&v2)?, tgas(100), yocto(0))]).await?;
    r.sent("T3C.2", "parent calls user-c.self_upgrade(v2) (#[private] guard)", &s);
    r.save();
    Ok(())
}

/// T5: what does the in-contract host function current_contract_code() report?
async fn t5(lab: &Lab) -> Result<()> {
    use near_primitives::types::AccountId;
    let mut r = Report::new("t5_current_contract_code");
    let v1 = wasm("target_v1");
    let v2 = wasm("target_v2");
    let h1 = CryptoHash::hash_bytes(&v1);
    let h2 = CryptoHash::hash_bytes(&v2);
    r.note("T5.hashes", "wasm hashes", json!({"v1": h1.to_string(), "v2": h2.to_string()}));
    let info = |id: &str| {
        let id: AccountId = id.parse().unwrap();
        async move { lab.rpc.view_call(&id, "code_info", json!({})).await.map_err(|e| e.to_string()) }
    };

    // local deploy
    let local = lab.create(&lab.root, "t5-local.sandbox", 10, Some(v1.clone())).await?;
    r.note("T5.local", "local DeployContract(v1) -> code_info (view call)", json!(info("t5-local.sandbox").await));
    let s = lab.rpc.send(&lab.parent, &local.id(), vec![a_call("code_info", json!({}), tgas(10), yocto(0))]).await?;
    r.sent("T5.local.tx", "code_info as tx", &s);

    // global by hash
    let pubr = lab.create(&lab.root, "t5-pub.sandbox", 100, None).await?;
    for code in [&v1, &v2] {
        let s = lab.rpc.send(&pubr, &pubr.id(), vec![Action::DeployGlobalContract(DeployGlobalContractAction {
            code: code.clone().into(), deploy_mode: GlobalContractDeployMode::CodeHash })]).await?;
        assert!(s.ok(), "{}", s.line());
    }
    let by_hash = Key::random("t5-byhash.sandbox");
    let s = lab.rpc.send(&lab.root, &by_hash.id(), vec![a_create(), a_transfer(near(5)),
        Action::UseGlobalContract(Box::new(UseGlobalContractAction { contract_identifier: GlobalContractIdentifier::CodeHash(h1) }))]).await?;
    r.sent("T5.hash.0", "t5-byhash: create + UseGlobalContract(CodeHash v1), no keys", &s);
    lab.wait_blocks(1).await?;
    r.note("T5.hash", "by-hash -> code_info", json!(info("t5-byhash.sandbox").await));

    // global by account, with redeploy
    let owner = lab.create(&lab.root, "t5-owner.sandbox", 100, None).await?;
    let dg = |c: &Vec<u8>| Action::DeployGlobalContract(DeployGlobalContractAction { code: c.clone().into(), deploy_mode: GlobalContractDeployMode::AccountId });
    let s = lab.rpc.send(&owner, &owner.id(), vec![dg(&v1)]).await?;
    assert!(s.ok(), "{}", s.line());
    let by_acct = Key::random("t5-byacct.sandbox");
    let s = lab.rpc.send(&lab.root, &by_acct.id(), vec![a_create(), a_transfer(near(5)),
        Action::UseGlobalContract(Box::new(UseGlobalContractAction { contract_identifier: GlobalContractIdentifier::AccountId(owner.id()) }))]).await?;
    r.sent("T5.acct.0", "t5-byacct: create + UseGlobalContract(AccountId owner), no keys", &s);
    lab.wait_blocks(1).await?;
    let before = info("t5-byacct.sandbox").await;
    let ver_before = lab.rpc.view_call(&by_acct.id(), "version", json!({})).await?;
    r.note("T5.acct.before", "by-account BEFORE owner redeploy", json!({"code_info": before, "version": ver_before}));
    let s = lab.rpc.send(&owner, &owner.id(), vec![dg(&v2)]).await?;
    assert!(s.ok(), "{}", s.line());
    lab.wait_blocks(4).await?;
    let after = info("t5-byacct.sandbox").await;
    let ver_after = lab.rpc.view_call(&by_acct.id(), "version", json!({})).await?;
    r.note("T5.acct.after", "by-account AFTER owner redeploy v2", json!({"code_info": after, "version": ver_after,
        "view_code_hash": lab.rpc.view_code_hash(&by_acct.id()).await?["hash"]}));
    r.save();
    Ok(())
}
