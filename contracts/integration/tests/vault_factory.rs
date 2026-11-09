//! Stage 3 acceptance on a local sandbox (docs/BUILD-PLAN.md):
//! - a factory-deployed vault holds no key at all and is bound to the vault code by hash
//! - only authorized classifiers write a class; only the factory registers a vault
//! - an agent key is refused by the network for every forbidden action (the isolation demo)
//! - a revoked agent's transaction is rejected by the network, never executed
//!
//! Run with --nocapture to print the refusals.

use aruna_integration::rpc::{self, Sent};
use aruna_integration::{key_of, wasm};
use near_primitives::action::{Action, DeployGlobalContractAction, GlobalContractDeployMode};
use near_primitives::hash::CryptoHash;
use near_primitives::types::AccountId;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{json, Value};

fn ceiling() -> Value {
    json!({
        "max_per_tx": "1000000000000000000000000",
        "daily_total": "5000000000000000000000000",
        "max_risk_class": "local_upgradeable",
        "allowed_targets": ["swap.test.near"],
        "agent_allowance": "250000000000000000000000"
    })
}

fn policy() -> Value {
    json!({
        "max_per_tx": "500000000000000000000000",
        "daily_cap": "2000000000000000000000000",
        "max_slippage_bps": 50,
        "allowed_targets": ["swap.test.near"],
        "max_risk_class": "immutable_verified"
    })
}

fn rejected_with(s: &Sent, needle: &str) -> bool {
    !s.ok() && s.error.to_string().contains(needle)
}

#[tokio::test]
async fn factory_vault_has_no_key_and_agents_are_contained() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let lab = rpc::Rpc::new(&worker.rpc_addr());

    // The vault code, published once as a global contract by hash.
    let vault_code = wasm("aruna_vault");
    let vault_hash = CryptoHash::hash_bytes(&vault_code);
    let publisher = root.create_subaccount("publisher").initial_balance(NearToken::from_near(100)).transact().await?.into_result()?;
    let publisher_id: AccountId = publisher.id().as_str().parse()?;
    let balance = |v: Value| v["amount"].as_str().unwrap().parse::<u128>().unwrap();
    let before = balance(lab.view_account(&publisher_id).await?);
    let s = lab
        .send(&key_of(&publisher), &publisher_id, vec![Action::DeployGlobalContract(DeployGlobalContractAction {
            code: vault_code.into(),
            deploy_mode: GlobalContractDeployMode::CodeHash,
        })])
        .await?;
    assert!(s.ok(), "global deploy: {}", s.line());
    let cost = before - balance(lab.view_account(&publisher_id).await?);
    println!("global deploy of {} bytes by hash cost {} yoctoNEAR (sandbox)", wasm("aruna_vault").len(), cost);

    // Registry and factory.
    let owner = root.create_subaccount("owner").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let registry = root.create_subaccount("registry").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let registry = registry.deploy(&wasm("aruna_registry")).await?.into_result()?;
    registry.call("new").args_json(json!({ "owner": owner.id() })).transact().await?.into_result()?;
    let factory = root.create_subaccount("aruna").initial_balance(NearToken::from_near(30)).transact().await?.into_result()?;
    let factory = factory.deploy(&wasm("aruna_factory")).await?.into_result()?;
    factory
        .call("new")
        .args_json(json!({ "owner": owner.id(), "registry": registry.id(), "vault_code_hash": vault_hash.to_string() }))
        .transact()
        .await?
        .into_result()?;
    owner.call(registry.id(), "set_factory").args_json(json!({ "factory": factory.id() })).transact().await?.into_result()?;

    // Only the factory may register a vault.
    let forged = owner
        .call(registry.id(), "register_vault")
        .args_json(json!({ "vault": "fake.test.near", "owner": owner.id(), "code_hash": "X" }))
        .transact()
        .await?;
    assert!(forged.is_failure(), "a non-factory registered a vault");

    // The AaaS company creates a vault for its client.
    let client = root.create_subaccount("client").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let company = root.create_subaccount("company").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let r = company
        .call(factory.id(), "create_vault")
        .args_json(json!({ "name": "acme", "owner": client.id(), "operator": company.id(), "ceiling": ceiling() }))
        .deposit(NearToken::from_near(2))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    assert!(r.is_success(), "create_vault: {:?}", r.failures());
    let vault_id: AccountId = format!("acme.{}", factory.id()).parse()?;
    let vault_ws: near_workspaces::AccountId = vault_id.as_str().parse()?;

    // No key of any kind, and the code is referenced by hash.
    let keys = lab.view_access_key_list(&vault_id).await?;
    assert_eq!(keys["keys"].as_array().unwrap().len(), 0, "vault keys: {keys}");
    let account = lab.view_account(&vault_id).await?;
    assert_eq!(account["global_contract_hash"], json!(vault_hash.to_string()));
    let rec: Value = registry.view("get_vault").args_json(json!({ "vault": vault_id })).await?.json()?;
    assert_eq!(rec["code_hash"], json!(vault_hash.to_string()));
    assert_eq!(rec["owner"], json!(client.id()));
    println!("vault {vault_id}: 0 access keys, global_contract_hash {vault_hash}, registered with its code hash");

    // The operator adds an agent; the vault adds the key to itself.
    let agent = rpc::Key::random(vault_id.as_str());
    company
        .call(&vault_ws, "add_agent")
        .args_json(json!({ "public_key": agent.pk().to_string(), "label": "trader-1", "policy": policy() }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    let keys = lab.view_access_key_list(&vault_id).await?;
    let ks = keys["keys"].as_array().unwrap();
    assert_eq!(ks.len(), 1);
    let perm = &ks[0]["access_key"]["permission"]["FunctionCall"];
    assert_eq!(perm["receiver_id"], json!(vault_id));
    assert_eq!(perm["method_names"], json!(["spend", "refresh_class"]));
    assert!(ks.iter().all(|k| k["access_key"]["permission"] != json!("FullAccess")));

    // Six things an agent key must not do (transfer tried at two sizes). Each is refused by the network.
    let me = vault_id.clone();
    let registry_id: AccountId = registry.id().as_str().parse()?;
    let cases: Vec<(&str, AccountId, Vec<Action>, &str)> = vec![
        ("transfer 1 yoctoNEAR out", me.clone(), vec![rpc::a_transfer(rpc::yocto(1))], "RequiresFullAccess"),
        // A transfer larger than the allowance fails the allowance check first: still refused.
        ("transfer 1 NEAR out", me.clone(), vec![rpc::a_transfer(rpc::near(1))], "NotEnoughAllowance"),
        ("add a full-access key", me.clone(), vec![rpc::a_add_full(rpc::Key::random("attacker.test.near").pk())], "RequiresFullAccess"),
        ("deploy code over the vault", me.clone(), vec![rpc::a_deploy(wasm("aruna_registry"))], "RequiresFullAccess"),
        ("call another contract", registry_id, vec![rpc::a_call("get_class", json!({ "target": "x" }), rpc::tgas(10), rpc::yocto(0))], "ReceiverMismatch"),
        ("call withdraw_to_owner", me.clone(), vec![rpc::a_call("withdraw_to_owner", json!({ "amount": "1" }), rpc::tgas(10), rpc::yocto(0))], "MethodNameMismatch"),
        ("attach a deposit to spend", me.clone(), vec![rpc::a_call("spend", json!({}), rpc::tgas(10), rpc::yocto(1))], "DepositWithFunctionCall"),
    ];
    println!("\nisolation: an agent key on {vault_id}");
    for (what, receiver, actions, expected) in cases {
        let s = lab.send(&agent, &receiver, actions).await?;
        println!("  {what:<34} -> {}", s.error);
        assert!(rejected_with(&s, expected), "{what}: expected {expected}, got {}", s.line());
        assert_eq!(s.kind, "Rejected", "{what} reached the chain");
    }

    // Revocation: the key is deleted, so the network rejects the agent.
    company.call(&vault_ws, "revoke_agent").args_json(json!({ "public_key": agent.pk().to_string() })).transact().await?.into_result()?;
    assert_eq!(lab.view_access_key_list(&vault_id).await?["keys"].as_array().unwrap().len(), 0);
    let s = lab.send(&agent, &vault_id, vec![rpc::a_call("spend", json!({}), rpc::tgas(10), rpc::yocto(0))]).await;
    let refused = match s {
        Ok(s) => rejected_with(&s, "AccessKeyNotFound"),
        Err(e) => e.to_string().contains("UNKNOWN_ACCESS_KEY") || e.to_string().contains("does not exist"),
    };
    assert!(refused, "a revoked key must be refused by the network");
    println!("  {:<34} -> refused, access key no longer exists", "revoked agent calls spend");

    // Classifier writes are authorized.
    let stranger = root.create_subaccount("stranger").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let r = stranger
        .call(registry.id(), "set_class")
        .args_json(json!({ "target": "swap.test.near", "class": "immutable_verified", "evidence_hash": "H" }))
        .transact()
        .await?;
    assert!(r.is_failure(), "an unauthorized account wrote a class");
    Ok(())
}
