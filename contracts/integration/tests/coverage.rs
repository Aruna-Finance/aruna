//! The coverage loop on a sandbox (plan U7; docs/BUILD-PLAN.md Stage 7 acceptance). One stack per
//! test: registry v2, factory, pool, vault v3, a test USDC token, and the drift target running a
//! global contract BY ACCOUNT under `target-owner`, whose redeploy is a real code change that the
//! target's `view_account.code_hash` never shows. Run with --nocapture to read the story.

#![allow(unused_must_use)]

use aruna_integration::{fixture_wasm, key_of, returned, rpc, wasm, NEAR};
use near_crypto::{KeyType, SecretKey, Signature};
use near_primitives::action::{Action, DeployGlobalContractAction, GlobalContractDeployMode, GlobalContractIdentifier, UseGlobalContractAction};
use near_primitives::hash::CryptoHash;
use near_primitives::types::AccountId;
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const MILLI: u128 = NEAR / 1_000;
const USDC: u128 = 1_000_000; // six decimals
// Testnet parameters from aruna_common::params, repeated here so a change there is a visible edit.
const WAITING: u64 = 120;
const WINDOW: u64 = 300;
const STALE: u64 = 600;

struct Stack {
    worker: Worker<Sandbox>,
    lab: rpc::Rpc,
    owner: Account,
    registry: Contract,
    pool: Contract,
    usdc: Contract,
    client: Account,
    underwriter: Account,
    target_owner: Account,
    target: AccountId,
    vault: AccountId,
    agent: rpc::Key,
    attestor_a: Account,
    attestor_b: Account,
    key_a: SecretKey,
    key_b: SecretKey,
    v1_hash: String,
    v2_hash: String,
}

fn ws(id: &AccountId) -> near_workspaces::AccountId {
    id.as_str().parse().unwrap()
}

async fn ok(r: near_workspaces::result::ExecutionFinalResult, what: &str) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    anyhow::ensure!(r.is_success(), "{what}: {:?}", r.failures());
    Ok(r)
}

fn ev(r: &near_workspaces::result::ExecutionFinalResult, name: &str) -> Vec<Value> {
    r.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|j| serde_json::from_str::<Value>(j).ok())
        .filter(|e| e["event"] == name)
        .map(|e| e["data"][0].clone())
        .collect()
}

impl Stack {
    async fn new() -> anyhow::Result<Stack> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;
        let lab = rpc::Rpc::new(&worker.rpc_addr());
        let sub = |name: &'static str, near: u128| {
            let root = root.clone();
            async move { root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result().map_err(anyhow::Error::from) }
        };

        // Vault v3 by hash.
        let vault_code = wasm("aruna_vault");
        let vault_hash = CryptoHash::hash_bytes(&vault_code).to_string();
        let publisher = sub("publisher", 100).await?;
        let s = lab
            .send(&key_of(&publisher), &publisher.id().as_str().parse()?, vec![Action::DeployGlobalContract(DeployGlobalContractAction { code: vault_code.into(), deploy_mode: GlobalContractDeployMode::CodeHash })])
            .await?;
        anyhow::ensure!(s.ok(), "global deploy: {}", s.line());

        let owner = sub("owner", 50).await?;
        let registry = sub("registry", 20).await?.deploy(&wasm("aruna_registry")).await?.into_result()?;
        ok(registry.call("new").args_json(json!({ "owner": owner.id() })).transact().await?, "registry new").await?;
        let factory = sub("aruna", 30).await?.deploy(&wasm("aruna_factory")).await?.into_result()?;
        ok(factory.call("new").args_json(json!({ "owner": owner.id(), "registry": registry.id(), "vault_code_hash": vault_hash })).transact().await?, "factory new").await?;
        let pool = sub("pool", 20).await?.deploy(&wasm("aruna_pool")).await?.into_result()?;
        ok(pool.call("new").args_json(json!({ "owner": owner.id(), "registry": registry.id() })).transact().await?, "pool new").await?;
        for (m, a) in [
            ("add_classifier", json!({ "account": owner.id() })),
            ("set_factory", json!({ "factory": factory.id() })),
            ("set_pool", json!({ "pool": pool.id() })),
            ("allow_vault_code_hash", json!({ "code_hash": vault_hash, "allowed": true })),
        ] {
            ok(owner.call(registry.id(), m).args_json(a).transact().await?, m).await?;
        }

        // Test USDC.
        let usdc = sub("usdc", 20).await?.deploy(&fixture_wasm("usdc/usdc.wasm")).await?.into_result()?;
        ok(usdc.call("new").args_json(json!({ "owner": owner.id() })).transact().await?, "usdc new").await?;

        // The drift target: v1 published by account under target-owner; target runs it by account.
        let target_owner = sub("target-owner", 50).await?;
        let v1 = fixture_wasm("drift-target/v1/drift_target.wasm");
        let v2 = fixture_wasm("drift-target/v2/drift_target.wasm");
        let (v1_hash, v2_hash) = (CryptoHash::hash_bytes(&v1).to_string(), CryptoHash::hash_bytes(&v2).to_string());
        let to_id: AccountId = target_owner.id().as_str().parse()?;
        let s = lab.send(&key_of(&target_owner), &to_id, vec![Action::DeployGlobalContract(DeployGlobalContractAction { code: v1.into(), deploy_mode: GlobalContractDeployMode::AccountId })]).await?;
        anyhow::ensure!(s.ok(), "publish v1: {}", s.line());
        let target_acc = sub("target", 30).await?;
        let target: AccountId = target_acc.id().as_str().parse()?;
        let s = lab
            .send(&key_of(&target_acc), &target, vec![Action::UseGlobalContract(Box::new(UseGlobalContractAction { contract_identifier: GlobalContractIdentifier::AccountId(to_id.clone()) }))])
            .await?;
        anyhow::ensure!(s.ok(), "use global by account: {}", s.line());

        let client = sub("client", 50).await?;
        let company = sub("company", 50).await?;
        let underwriter = sub("underwriter", 200).await?;
        let usdc_id: AccountId = usdc.id().as_str().parse()?;
        let ceiling = json!({
            "tokens": [
                { "token": "near", "max_per_tx": NEAR.to_string(), "daily_total": (4 * NEAR).to_string() },
                { "token": { "ft": usdc_id }, "max_per_tx": (10 * USDC).to_string(), "daily_total": (40 * USDC).to_string() }
            ],
            "max_risk_class": "global_by_account",
            "allowed_targets": [target],
            "agent_allowance": (2 * NEAR).to_string()
        });
        ok(
            company
                .call(factory.id(), "create_vault")
                .args_json(json!({ "name": "acme", "owner": client.id(), "operator": company.id(), "ceiling": ceiling }))
                .deposit(NearToken::from_near(10))
                .gas(Gas::from_tgas(150))
                .transact()
                .await?,
            "create_vault",
        )
        .await?;
        let vault: AccountId = format!("acme.{}", factory.id()).parse()?;

        let agent = rpc::Key::random(vault.as_str());
        let policy = json!({
            "limits": [
                { "token": "near", "max_per_tx": (500 * MILLI).to_string(), "daily_cap": NEAR.to_string() },
                { "token": { "ft": usdc_id }, "max_per_tx": (5 * USDC).to_string(), "daily_cap": (10 * USDC).to_string() }
            ],
            "max_slippage_bps": 100,
            "allowed_targets": [target],
            "max_risk_class": "global_by_account"
        });
        ok(
            company
                .call(&ws(&vault), "add_agent")
                .args_json(json!({ "public_key": agent.pk().to_string(), "label": "trader", "policy": policy }))
                .deposit(NearToken::from_yoctonear(1))
                .transact()
                .await?,
            "add_agent",
        )
        .await?;

        ok(
            owner
                .call(registry.id(), "set_class")
                .args_json(json!({ "target": target, "class": "global_by_account", "evidence_hash": "e", "resolved_code_hash": v1_hash, "upgrade_authority": target_owner.id() }))
                .transact()
                .await?,
            "set_class",
        )
        .await?;

        let attestor_a = sub("attestor-a", 20).await?;
        let attestor_b = sub("attestor-b", 20).await?;
        let key_a = SecretKey::from_seed(KeyType::ED25519, "attestor-a signing key");
        let key_b = SecretKey::from_seed(KeyType::ED25519, "attestor-b signing key");
        for (a, k) in [(&attestor_a, &key_a), (&attestor_b, &key_b)] {
            ok(a.call(registry.id(), "register_attestor").args_json(json!({ "signing_key": k.public_key().to_string() })).deposit(NearToken::from_near(1)).transact().await?, "register_attestor").await?;
        }
        ok(owner.call(registry.id(), "assign_attestor").args_json(json!({ "target": target, "attestor": attestor_a.id() })).transact().await?, "assign").await?;

        Ok(Stack { worker, lab, owner, registry, pool, usdc, client, underwriter, target_owner, target, vault, agent, attestor_a, attestor_b, key_a, key_b, v1_hash, v2_hash })
    }

    async fn height(&self) -> anyhow::Result<u64> {
        Ok(self.lab.latest_block().await?.1)
    }

    async fn pool_view(&self, m: &str, a: Value) -> anyhow::Result<Value> {
        Ok(self.worker.view(self.pool.id(), m).args_json(a).await?.json()?)
    }

    async fn vault_view(&self, m: &str, a: Value) -> anyhow::Result<Value> {
        Ok(self.worker.view(&ws(&self.vault), m).args_json(a).await?.json()?)
    }

    async fn agent(&self, method: &str, args: Value, tgas: u64) -> anyhow::Result<rpc::Sent> {
        self.lab.send(&self.agent, &self.vault, vec![rpc::a_call(method, args, rpc::tgas(tgas), rpc::yocto(0))]).await
    }

    async fn heartbeat(&self, a: &Account) -> anyhow::Result<()> {
        ok(a.call(self.registry.id(), "heartbeat").transact().await?, "heartbeat").await?;
        Ok(())
    }

    async fn underwrite_near(&self, near: u128) -> anyhow::Result<()> {
        ok(self.underwriter.call(self.pool.id(), "deposit").deposit(NearToken::from_near(near)).transact().await?, "deposit").await?;
        Ok(())
    }

    fn request(&self, limit: u128, window: u64) -> Value {
        json!({ "vault": self.vault, "agent": self.agent.pk().to_string(), "target": self.target, "limit": limit.to_string(), "payout_ratio_bps": 8_000, "window_blocks": window })
    }

    /// Two quotes that differ only in daily_cap (plan R29).
    async fn quote(&self, limit: u128, window: u64, cap: u128) -> anyhow::Result<Value> {
        self.pool_view("quote", json!({ "class": "global_by_account", "limit": limit.to_string(), "payout_ratio_bps": 8_000, "window_blocks": window, "daily_cap": cap.to_string() })).await
    }

    async fn buy_near(&self, limit: u128, window: u64, premium: u128) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
        ok(
            self.client.call(self.pool.id(), "buy_coverage").args_json(json!({ "request": self.request(limit, window) })).deposit(NearToken::from_yoctonear(premium)).gas(Gas::from_tgas(200)).transact().await?,
            "buy_coverage",
        )
        .await
    }

    async fn swap_near(&self, amount: u128) -> anyhow::Result<rpc::Sent> {
        let min = amount - amount / 100;
        self.agent("spend", json!({ "adapter": "swap", "target": self.target, "amount": amount.to_string(), "min_amount_out": min.to_string() }), 60).await
    }

    /// The target owner republishes by account: the target now runs v2 with no transaction to it.
    async fn redeploy_v2(&self) -> anyhow::Result<()> {
        let to: AccountId = self.target_owner.id().as_str().parse()?;
        let s = self.lab.send(&key_of(&self.target_owner), &to, vec![Action::DeployGlobalContract(DeployGlobalContractAction { code: fixture_wasm("drift-target/v2/drift_target.wasm").into(), deploy_mode: GlobalContractDeployMode::AccountId })]).await?;
        anyhow::ensure!(s.ok(), "publish v2: {}", s.line());
        Ok(())
    }

    fn report(&self, attestor: &Account, changed: u64, observed: u64, nonce: u64) -> Value {
        json!({
            "target": self.target,
            "observed_at_block": observed,
            "changed_at_block": changed,
            "before_ref": { "kind": "global_account", "owner_account": self.target_owner.id() },
            "after_ref": { "kind": "global_account", "owner_account": self.target_owner.id() },
            "before_resolved_hash": self.v1_hash,
            "after_resolved_hash": self.v2_hash,
            "channel": "deploy_global_contract",
            "attestor": attestor.id(),
            "nonce": nonce,
            "expires_at": observed + 600
        })
    }

    /// Signs `report` with `key` over exactly the bytes the registry verifies (DriftReport::signing_bytes).
    fn sign(report: &Value, key: &SecretKey) -> String {
        use base64::Engine;
        let r: aruna_common::DriftReport = serde_json::from_value(report.clone()).unwrap();
        let sig = match key.sign(&r.signing_bytes()) {
            Signature::ED25519(s) => s.to_bytes().to_vec(),
            _ => unreachable!(),
        };
        base64::engine::general_purpose::STANDARD.encode(sig)
    }

    async fn file(&self, attestor: &Account, key: &SecretKey, report: Value) -> anyhow::Result<u32> {
        let sig = Self::sign(&report, key);
        let r = ok(attestor.call(self.registry.id(), "report_drift").args_json(json!({ "report": report, "signature": sig })).gas(Gas::from_tgas(50)).transact().await?, "report_drift").await?;
        Ok(r.json::<u32>()?)
    }

    async fn claim(&self, coverage: u32, report: u32) -> anyhow::Result<Value> {
        ok(self.underwriter.call(self.pool.id(), "claim").args_json(json!({ "coverage_id": coverage, "report_id": report })).gas(Gas::from_tgas(300)).transact().await?, "claim").await?;
        let c = self.pool_view("get_coverage", json!({ "id": coverage })).await?;
        Ok(c["claims"].as_array().unwrap().last().cloned().unwrap_or(Value::Null))
    }

    async fn near_balance(&self, a: &Account) -> anyhow::Result<u128> {
        Ok(a.view_account().await?.balance.as_yoctonear())
    }
}

/// Covers F1–F5, AE1, R29, R30, R16, R17, R19, R21, R22: the whole NEAR loop.
#[tokio::test]
async fn the_near_loop_from_quote_to_payout() -> anyhow::Result<()> {
    let s = Stack::new().await?;
    s.underwrite_near(50).await?;
    s.heartbeat(&s.attestor_a).await?;

    // Two quotes for the same coverage, differing only in daily_cap: the tight one is cheaper.
    let window = 2 * 43_200;
    let loose = s.quote(10 * NEAR, window, 5 * NEAR).await?;
    let tight = s.quote(10 * NEAR, window, NEAR).await?;
    let (lp, tp): (u128, u128) = (loose["premium"].as_str().unwrap().parse()?, tight["premium"].as_str().unwrap().parse()?);
    println!("quote, daily_cap 5 NEAR -> reachable {} premium {}", loose["reachable_payout"], lp);
    println!("quote, daily_cap 1 NEAR -> reachable {} premium {}", tight["reachable_payout"], tp);
    assert!(tp < lp, "a tighter daily cap must quote lower");

    // The agent's real cap is 1 NEAR: the client buys at the tight price.
    let r = s.buy_near(10 * NEAR, window, tp).await?;
    assert_eq!(ev(&r, "coverage_refused"), Vec::<Value>::new(), "{:?}", r.logs());
    let cov = s.pool_view("get_coverage", json!({ "id": 0 })).await?;
    assert_eq!(cov["premium_paid"], json!(tp.to_string()));
    assert_eq!(cov["daily_cap_priced"], json!(NEAR.to_string()));

    s.worker.fast_forward(WAITING + 1).await?;
    let sent = s.agent("refresh_class", json!({ "target": s.target }), 60).await?;
    assert!(sent.ok(), "{}", sent.line());
    let sent = s.swap_near(400 * MILLI).await?;
    assert_eq!(returned(&sent), json!(true), "swap settled: {}", sent.line());

    // The change: no transaction touches the target, and its code_hash stays the zero hash.
    let before = s.lab.view_account(&s.target).await?;
    let changed = s.height().await? + 1;
    s.redeploy_v2().await?;
    let after = s.lab.view_account(&s.target).await?;
    assert_eq!(before["code_hash"], after["code_hash"]);
    assert_eq!(s.lab.view_call(&s.target, "version", json!({})).await?, "\"drift-target-v2\"");
    println!("target code_hash before {} after {} (unchanged); version() now v2", before["code_hash"], after["code_hash"]);

    // Exposure recorded after the change but before the report must not count.
    let late = s.swap_near(300 * MILLI).await?;
    assert_eq!(returned(&late), json!(true));

    let now = s.height().await?;
    let id = s.file(&s.attestor_a, &s.key_a, s.report(&s.attestor_a, changed, now, 1)).await?;
    let pushed = ok(s.underwriter.call(s.registry.id(), "push_freeze").args_json(json!({ "target": s.target, "from": 0, "limit": 10 })).gas(Gas::from_tgas(100)).transact().await?, "push_freeze").await?;
    assert!(!pushed.logs().is_empty());
    let refused = s.swap_near(100 * MILLI).await?;
    assert_eq!(returned(&refused)["reason"], json!("ARUNA_TARGET_FROZEN"), "{}", refused.line());

    // Before the window closes the claim is refused, with the reason recorded.
    let early = s.claim(0, id).await?;
    assert_eq!(early["outcome"], json!("challenge window still open"));

    s.worker.fast_forward(WINDOW + 1).await?;
    let client_before = s.near_balance(&s.client).await?;
    let paid = s.claim(0, id).await?;
    assert_eq!(paid["outcome"], json!("paid"), "{paid}");
    let expected = 400 * MILLI * 8 / 10;
    assert_eq!(paid["paid"], json!(expected.to_string()), "0.4 NEAR before the change x 80%; the 0.3 NEAR after it does not count");
    assert_eq!(s.near_balance(&s.client).await? - client_before, expected);
    println!("payout {} yoctoNEAR = min(exposure_before x 80%, C)", expected);
    Ok(())
}

/// Covers AE7 and R1–R5: the same loop in the test USDC, paid from the USDC book.
#[tokio::test]
async fn the_usdc_loop_pays_from_the_usdc_book() -> anyhow::Result<()> {
    let s = Stack::new().await?;
    s.heartbeat(&s.attestor_a).await?;
    let usdc = s.usdc.id().clone();
    for a in [s.vault.as_str(), s.pool.id().as_str(), s.client.id().as_str(), s.underwriter.id().as_str(), s.target.as_str()] {
        ok(s.owner.call(&usdc, "storage_deposit").args_json(json!({ "account_id": a })).deposit(NearToken::from_millinear(10)).transact().await?, "storage_deposit").await?;
    }
    for (a, amt) in [(s.underwriter.id().as_str(), 1_000 * USDC), (s.client.id().as_str(), 50 * USDC), (s.vault.as_str(), 20 * USDC)] {
        ok(s.owner.call(&usdc, "mint").args_json(json!({ "account_id": a, "amount": amt.to_string() })).transact().await?, "mint").await?;
    }
    ok(
        s.underwriter.call(&usdc, "ft_transfer_call").args_json(json!({ "receiver_id": s.pool.id(), "amount": (1_000 * USDC).to_string(), "msg": "{\"action\":\"deposit\"}" })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?,
        "usdc deposit",
    )
    .await?;
    let near_book_before = s.pool_view("get_book", json!({ "token": "near" })).await?;

    let window = 43_200;
    let q = s.pool_view("quote", json!({ "class": "global_by_account", "limit": (100 * USDC).to_string(), "payout_ratio_bps": 8_000, "window_blocks": window, "daily_cap": (10 * USDC).to_string() })).await?;
    let premium: u128 = q["premium"].as_str().unwrap().parse()?;
    let mut msg = s.request(100 * USDC, window);
    msg["action"] = json!("buy");
    let r = ok(
        s.client.call(&usdc, "ft_transfer_call").args_json(json!({ "receiver_id": s.pool.id(), "amount": (premium + USDC).to_string(), "msg": msg.to_string() })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(300)).transact().await?,
        "usdc buy",
    )
    .await?;
    assert_eq!(ev(&r, "coverage_refused"), Vec::<Value>::new(), "{:?}", r.logs());
    let client_usdc: u128 = s.worker.view(&usdc, "ft_balance_of").args_json(json!({ "account_id": s.client.id() })).await?.json::<String>()?.parse()?;
    assert_eq!(client_usdc, 50 * USDC - premium, "the 1 USDC excess came back");
    let usdc_book = s.pool_view("get_book", json!({ "token": { "ft": usdc } })).await?;
    assert_eq!(usdc_book["capital"], json!((1_000 * USDC + premium).to_string()));
    assert_eq!(s.pool_view("get_book", json!({ "token": "near" })).await?, near_book_before, "the NEAR book is untouched");

    s.worker.fast_forward(WAITING + 1).await?;
    assert!(s.agent("refresh_class", json!({ "target": s.target }), 60).await?.ok());
    let spent = s.agent("spend", json!({ "adapter": "ft_swap", "target": s.target, "amount": (4 * USDC).to_string(), "min_amount_out": (4 * USDC - 4 * USDC / 100).to_string(), "token": usdc }), 150).await?;
    assert_eq!(returned(&spent), json!(true), "{}", spent.line());
    assert_eq!(s.vault_view("get_exposure", json!({ "target": s.target, "token": { "ft": usdc } })).await?["amount"], json!((4 * USDC).to_string()));

    let changed = s.height().await? + 1;
    s.redeploy_v2().await?;
    let now = s.height().await?;
    let id = s.file(&s.attestor_a, &s.key_a, s.report(&s.attestor_a, changed, now, 1)).await?;
    // No freeze batch was pushed: the vault still learns of the freeze at its next refresh (R16).
    assert!(s.agent("refresh_class", json!({ "target": s.target }), 60).await?.ok());
    let refused = s.agent("spend", json!({ "adapter": "ft_swap", "target": s.target, "amount": USDC.to_string(), "min_amount_out": "0", "token": usdc }), 150).await?;
    assert_eq!(returned(&refused)["reason"], json!("ARUNA_TARGET_FROZEN"), "{}", refused.line());
    s.worker.fast_forward(WINDOW + 1).await?;
    let paid = s.claim(0, id).await?;
    assert_eq!(paid["outcome"], json!("paid"), "{paid}");
    assert_eq!(paid["paid"], json!((4 * USDC * 8 / 10).to_string()));
    let client_after: u128 = s.worker.view(&usdc, "ft_balance_of").args_json(json!({ "account_id": s.client.id() })).await?.json::<String>()?.parse()?;
    assert_eq!(client_after, 50 * USDC - premium + 4 * USDC * 8 / 10, "paid in USDC, from the USDC book");
    Ok(())
}

/// Covers F6, R18–R20: a conflicting report blocks payout; the arbiter upholds, then in a second
/// stack rejects and the bond moves to the pool.
#[tokio::test]
async fn a_dispute_blocks_payout_until_the_arbiter_rules() -> anyhow::Result<()> {
    for upheld in [true, false] {
        let s = Stack::new().await?;
        s.underwrite_near(50).await?;
        s.heartbeat(&s.attestor_a).await?;
        let window = 43_200;
        let q = s.quote(10 * NEAR, window, NEAR).await?;
        s.buy_near(10 * NEAR, window, q["premium"].as_str().unwrap().parse()?).await?;
        s.worker.fast_forward(WAITING + 1).await?;
        assert!(s.agent("refresh_class", json!({ "target": s.target }), 60).await?.ok());
        assert_eq!(returned(&s.swap_near(400 * MILLI).await?), json!(true));
        let changed = s.height().await? + 1;
        s.redeploy_v2().await?;
        let now = s.height().await?;
        let id = s.file(&s.attestor_a, &s.key_a, s.report(&s.attestor_a, changed, now, 1)).await?;
        // Attestor B disagrees about when it changed.
        s.file(&s.attestor_b, &s.key_b, s.report(&s.attestor_b, changed + 1, now, 1)).await?;
        s.worker.fast_forward(WINDOW + 1).await?;
        assert_eq!(s.claim(0, id).await?["outcome"], json!("report is disputed"));

        let near_capital_before: u128 = s.pool_view("get_book", json!({ "token": "near" })).await?["capital"].as_str().unwrap().parse()?;
        ok(s.owner.call(s.registry.id(), "rule").args_json(json!({ "report_id": id, "upheld": upheld })).gas(Gas::from_tgas(50)).transact().await?, "rule").await?;
        if upheld {
            assert_eq!(s.claim(0, id).await?["outcome"], json!("paid"));
        } else {
            assert_eq!(s.claim(0, id).await?["outcome"], json!("report was rejected by the arbiter"));
            let after: u128 = s.pool_view("get_book", json!({ "token": "near" })).await?["capital"].as_str().unwrap().parse()?;
            assert_eq!(after - near_capital_before, NEAR, "attestor A's 1 NEAR bond became NEAR capital");
        }
        println!("dispute, arbiter upheld={upheld}: ok");
    }
    Ok(())
}

/// Covers AE8: a stale heartbeat from the target's assigned attestor blocks new coverage.
#[tokio::test]
async fn a_stale_heartbeat_blocks_new_coverage() -> anyhow::Result<()> {
    let s = Stack::new().await?;
    s.underwrite_near(50).await?;
    s.worker.fast_forward(STALE + 5).await?;
    let q = s.quote(10 * NEAR, 43_200, NEAR).await?;
    let r = s.buy_near(10 * NEAR, 43_200, q["premium"].as_str().unwrap().parse()?).await?;
    let refused = ev(&r, "coverage_refused");
    assert_eq!(refused.len(), 1, "{:?}", r.logs());
    assert!(refused[0]["reason"].as_str().unwrap().contains("heartbeat"));
    assert_eq!(s.pool_view("coverage_count", json!({})).await?, json!(0));
    Ok(())
}
