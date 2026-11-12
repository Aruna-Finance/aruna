//! Migration to a new vault, driven by contract calls only (plan U15, R36 to R38; AE8). The SDK's
//! `runMigration` makes exactly these calls; this test shows the contracts allow every step and that
//! nothing in the old vault's state blocks them. Run with --nocapture to read the story.
//!
//! The flow (R36): pause the carried agents on the old vault, create the new vault with the same
//! owner, operator and ceiling, re-add each agent with its key and policy, move the funds, revoke the
//! agents on the old vault. A paused agent is re-added and paused in ONE transaction, so it is never
//! active on the new vault, not even between two blocks.

#![allow(unused_must_use)]

use aruna_integration::{fixture_wasm, returned, rpc, Env, NEAR};
use near_crypto::{KeyType, SecretKey};
use near_workspaces::operations::Function;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{json, Value};

const MILLI: u128 = NEAR / 1_000;
const USDC: u128 = 1_000_000;
/// The sandbox's storage price per byte, in yoctoNEAR.
const BYTE: u128 = 10_000_000_000_000_000_000;

fn ceiling(swap: &str) -> Value {
    json!({
        "tokens": [
            { "token": "near", "max_per_tx": NEAR.to_string(), "daily_total": (4 * NEAR).to_string() },
            { "token": { "ft": "usdc.test.near" }, "max_per_tx": (10 * USDC).to_string(), "daily_total": (40 * USDC).to_string() }
        ],
        "max_risk_class": "local_upgradeable",
        "allowed_targets": [swap],
        "agent_allowance": (2 * NEAR).to_string()
    })
}

fn policy(swap: &str, near_cap: u128) -> Value {
    json!({
        "limits": [
            { "token": "near", "max_per_tx": (500 * MILLI).to_string(), "daily_cap": near_cap.to_string() },
            { "token": { "ft": "usdc.test.near" }, "max_per_tx": (5 * USDC).to_string(), "daily_cap": (10 * USDC).to_string() }
        ],
        "max_slippage_bps": 50,
        "allowed_targets": [swap],
        "max_risk_class": "local_upgradeable"
    })
}

fn spend(target: &str) -> Value {
    json!({ "adapter": "swap", "target": target, "amount": (10 * MILLI).to_string(), "min_amount_out": "1" })
}

fn ws(s: &str) -> near_workspaces::AccountId {
    s.parse().unwrap()
}

async fn balance_of(env: &Env, id: &str) -> anyhow::Result<u128> {
    env.balance(&id.parse()?).await
}

async fn usdc_of(env: &Env, id: &str) -> anyhow::Result<u128> {
    Ok(env.worker.view(&ws("usdc.test.near"), "ft_balance_of").args_json(json!({ "account_id": id })).await?.json::<String>()?.parse()?)
}

#[tokio::test]
async fn a_vault_moves_to_a_new_one_with_its_agents_and_funds() -> anyhow::Result<()> {
    let env = Env::new(5, ceiling("swap.test.near")).await?;
    let swap = env.swap.as_str().to_string();
    let old = env.vault.as_str().to_string();
    let factory = old.strip_prefix("acme.").unwrap().to_string();
    let new = format!("acme2.{factory}");
    let root = env.worker.root_account()?;

    // Test USDC, listed in the ceiling by its account id.
    let usdc = root.create_subaccount("usdc").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?.deploy(&fixture_wasm("usdc/usdc.wasm")).await?.into_result()?;
    usdc.call("new").args_json(json!({ "owner": env.owner.id() })).transact().await?.into_result()?;
    for a in [old.as_str(), new.as_str(), env.client.id().as_str()] {
        env.owner.call(usdc.id(), "storage_deposit").args_json(json!({ "account_id": a })).deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    }
    env.owner.call(usdc.id(), "mint").args_json(json!({ "account_id": old, "amount": (20 * USDC).to_string() })).transact().await?.into_result()?;

    // The old vault: two active agents, one the operator paused, one revoked.
    let (sk1, sk2, skp, skr) = (SecretKey::from_random(KeyType::ED25519), SecretKey::from_random(KeyType::ED25519), SecretKey::from_random(KeyType::ED25519), SecretKey::from_random(KeyType::ED25519));
    let key_on = |vault: &str, sk: &SecretKey| rpc::Key::new(vault, sk.clone());
    for (label, sk, cap) in [("trader-1", &sk1, NEAR), ("trader-2", &sk2, NEAR / 2), ("paused-one", &skp, NEAR / 4), ("retired", &skr, NEAR / 4)] {
        env.company
            .call(&ws(&old), "add_agent")
            .args_json(json!({ "public_key": key_on(&old, sk).pk().to_string(), "label": label, "policy": policy(&swap, cap) }))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?
            .into_result()?;
    }
    env.company.call(&ws(&old), "pause_agent").args_json(json!({ "public_key": key_on(&old, &skp).pk().to_string() })).transact().await?.into_result()?;
    env.company.call(&ws(&old), "revoke_agent").args_json(json!({ "public_key": key_on(&old, &skr).pk().to_string() })).transact().await?.into_result()?;

    let old_agents = env.view("get_agents", json!({})).await?;
    let old_agents = old_agents.as_array().unwrap().clone();
    assert_eq!(old_agents.len(), 4);
    let config = env.view("get_config", json!({})).await?;

    // Step 1 (R36.1): the owner pauses every agent being carried over: the two active ones. The paused
    // one already is, and the revoked one is not carried.
    for sk in [&sk1, &sk2] {
        env.client.call(&ws(&old), "pause_agent").args_json(json!({ "public_key": key_on(&old, sk).pk().to_string() })).transact().await?.into_result()?;
    }
    // A key that is carried over can no longer spend on the old vault, though its key still exists.
    let s = env.agent_call(&key_on(&old, &sk1), "spend", spend(&swap)).await?;
    assert!(s.ok(), "{}", s.line());
    assert_eq!(returned(&s)["reason"], json!("ARUNA_AGENT_NOT_ACTIVE"), "step 1 must stop the carried key spending on the old vault");

    // Step 2 (R36.2): the new vault, same owner, operator and ceiling, created by the owner. The
    // deposit is the factory's minimum; the rest of the funds arrive in step 4.
    let r = env
        .client
        .call(&ws(&factory), "create_vault")
        .args_json(json!({ "name": "acme2", "owner": env.client.id(), "operator": config["operator"], "ceiling": config["ceiling"] }))
        .deposit(NearToken::from_millinear(500))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    anyhow::ensure!(r.is_success(), "create_vault: {:?}", r.failures());
    let new_config: Value = env.worker.view(&ws(&new), "get_config").await?.json()?;
    for field in ["owner", "operator", "ceiling"] {
        assert_eq!(new_config[field], config[field], "the new vault's {field} differs from the old one");
    }
    assert_eq!(new_config["registry"], config["registry"]);

    // Step 3 (R36.3): re-add every non-revoked agent, same key, label and policy. An agent that was
    // paused before the migration is paused in the SAME transaction as its add.
    let mut carried = vec![];
    for (pk, agent) in old_agents.iter().map(|p| (p[0].as_str().unwrap(), &p[1])) {
        if agent["status"] == json!("Revoked") {
            continue;
        }
        let was_paused = agent["status"] == json!("Paused");
        let add = Function::new("add_agent")
            .args_json(json!({ "public_key": pk, "label": agent["label"], "policy": agent["policy"] }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(30));
        let mut batch = env.client.batch(&ws(&new)).call(add);
        if was_paused {
            batch = batch.call(Function::new("pause_agent").args_json(json!({ "public_key": pk })).gas(Gas::from_tgas(30)));
        }
        let r = batch.transact().await?;
        anyhow::ensure!(r.is_success(), "re-add {pk}: {:?}", r.failures());
        carried.push((pk.to_string(), agent["policy"].clone(), was_paused));
    }
    assert_eq!(carried.len(), 3, "the revoked agent is not carried");
    for (pk, old_policy, was_paused) in &carried {
        let a: Value = env.worker.view(&ws(&new), "get_agent").args_json(json!({ "public_key": pk })).await?.json()?;
        assert_eq!(&a["policy"], old_policy, "policy of {pk} changed in the move");
        // The carried-over, previously active agents are Active on the new vault: that is the point.
        assert_eq!(a["status"], json!(if *was_paused { "Paused" } else { "Active" }));
    }
    // The agent that was already paused cannot spend on the new vault, and neither could it between the
    // add and the pause: they are one transaction.
    let sp = key_on(&new, &skp);
    let s = env.lab.send(&sp, &new.parse()?, vec![rpc::a_call("spend", spend(&swap), rpc::tgas(60), rpc::yocto(0))]).await?;
    assert!(s.ok(), "{}", s.line());
    assert_eq!(returned(&s)["reason"], json!("ARUNA_AGENT_NOT_ACTIVE"));
    let keys = env.lab.view_access_key_list(&new.parse()?).await?;
    assert_eq!(keys["keys"].as_array().unwrap().len(), 3, "three function-call keys on the new vault: {keys}");

    // Step 4 (R36.4): funds. NEAR leaves the old vault through withdraw_to_owner, down to what its
    // storage needs (R37), then the owner sends it on. USDC the same way, then ft_transfer_call.
    let acct = env.lab.view_account(&old.parse()?).await?;
    let (bal, usage): (u128, u128) = (acct["amount"].as_str().unwrap().parse()?, acct["storage_usage"].as_u64().unwrap() as u128);
    let keep = usage * BYTE + 10 * MILLI / 10; // storage plus 0.001 NEAR of margin
    let movable = bal - keep;
    let new_before = balance_of(&env, &new).await?;
    env.client.call(&ws(&old), "withdraw_to_owner").args_json(json!({ "amount": movable.to_string() })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    env.client.call(&ws(&old), "withdraw_to_owner").args_json(json!({ "amount": (20 * USDC).to_string(), "token": { "ft": "usdc.test.near" } })).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(60)).transact().await?.into_result()?;
    assert_eq!(usdc_of(&env, env.client.id().as_str()).await?, 20 * USDC, "the owner received the USDC");
    env.client.transfer_near(&ws(&new), NearToken::from_yoctonear(movable)).await?.into_result()?;
    env.client
        .call(usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": new, "amount": (20 * USDC).to_string(), "msg": "migration" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;

    // Step 5 (R36.5): revoke the agents on the old vault. After that no key can reach it.
    for (pk, _, _) in &carried {
        env.client.call(&ws(&old), "revoke_agent").args_json(json!({ "public_key": pk })).transact().await?.into_result()?;
    }

    // AE8 and R37: the old vault has no active agent and no key; its remaining balance is its storage.
    let still: Vec<Value> = env.view("get_agents", json!({})).await?.as_array().unwrap().iter().filter(|p| p[1]["status"] != json!("Revoked")).cloned().collect();
    assert!(still.is_empty(), "the old vault still has non-revoked agents: {still:?}");
    assert_eq!(env.lab.view_access_key_list(&env.vault).await?["keys"].as_array().unwrap().len(), 0);
    let left = balance_of(&env, &old).await?;
    assert!(left >= usage * BYTE && left <= keep + MILLI, "old vault keeps {left}, storage needs {}", usage * BYTE);
    assert_eq!(usdc_of(&env, &old).await?, 0);

    // The new vault holds the funds and the agents; it is a vault like any other.
    assert_eq!(usdc_of(&env, &new).await?, 20 * USDC);
    let new_after = balance_of(&env, &new).await?;
    assert!(new_after >= new_before + movable - MILLI, "new vault holds the moved NEAR: {new_after}");
    println!("moved {movable} yoctoNEAR and {} USDC units to {new}; {old} keeps {left} for storage", 20 * USDC);
    Ok(())
}
