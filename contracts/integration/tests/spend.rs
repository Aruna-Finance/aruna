//! The spend path on a sandbox: docs/TESTING.md "Reservation
//! accounting", "Class re-validation", "Refusals persist", "Class freshness", "Auto-disable",
//! "Failed callback" and "The callback footgun". Run with --nocapture to read the story.

use aruna_integration::{events, returned, rpc, Env, NEAR};
use serde_json::{json, Value};

const MILLI: u128 = NEAR / 1_000;

fn ceiling(swap: &str) -> Value {
    json!({
        "tokens": [{ "token": "near", "max_per_tx": (NEAR).to_string(), "daily_total": (4 * NEAR).to_string() }],
        "max_risk_class": "local_upgradeable",
        "allowed_targets": [swap],
        "agent_allowance": (2 * NEAR).to_string()
    })
}

fn policy(swap: &str, daily_cap: u128) -> Value {
    json!({
        "limits": [{ "token": "near", "max_per_tx": (500 * MILLI).to_string(), "daily_cap": daily_cap.to_string() }],
        "max_slippage_bps": 50,
        "allowed_targets": [swap],
        "max_risk_class": "local_upgradeable"
    })
}

fn spend(target: &str, amount: u128, min_out: u128) -> Value {
    json!({ "adapter": "swap", "target": target, "amount": amount.to_string(), "min_amount_out": min_out.to_string() })
}

/// Output of the fixture swap: 0.5% fee.
fn swap_out(amount: u128) -> u128 {
    amount - amount * 50 / 10_000
}

async fn add_agent(env: &Env, label: &str, policy: Value) -> anyhow::Result<rpc::Key> {
    let agent = rpc::Key::random(env.vault.as_str());
    env.company
        .call(&env.vault_ws(), "add_agent")
        .args_json(json!({ "public_key": agent.pk().to_string(), "label": label, "policy": policy }))
        .deposit(near_workspaces::types::NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    Ok(agent)
}

async fn agent_state(env: &Env, agent: &rpc::Key) -> anyhow::Result<Value> {
    env.view("get_agent", json!({ "public_key": agent.pk().to_string() })).await
}

fn reason(s: &rpc::Sent) -> String {
    returned(s)["reason"].as_str().unwrap_or("").to_string()
}

#[tokio::test]
async fn honest_agent_stale_class_reclassification_and_failed_settlement() -> anyhow::Result<()> {
    let env = Env::new(5, ceiling("swap.test.near")).await?;
    let swap = env.swap.as_str().to_string();
    let agent = add_agent(&env, "honest", policy(&swap, 2 * NEAR)).await?;
    env.classify(&env.swap, "immutable_verified").await?;

    // No class fetched yet: refused as stale, and the refusal returns (the tx succeeds).
    let s = env.agent_call(&agent, "spend", spend(&swap, 100 * MILLI, swap_out(100 * MILLI))).await?;
    assert!(s.ok(), "a refusal must return, not panic: {}", s.line());
    assert_eq!(reason(&s), "ARUNA_CLASS_STALE");
    assert_eq!(events(&s, "execution_rejected").len(), 1, "the refusal's event persists");
    assert!(agent_state(&env, &agent).await?["refusals"].as_array().unwrap().is_empty(), "stale does not count");
    println!("no class cached        -> {}", reason(&s));

    // The agent key may refresh; the vault pulls the class from the registry.
    let s = env.agent_call(&agent, "refresh_class", json!({ "target": swap })).await?;
    assert!(s.ok(), "{}", s.line());
    assert_eq!(env.view("get_class", json!({ "target": swap })).await?["class"], "immutable_verified");

    // Honest spend: proceeds come back to the vault, exposure records what was sent.
    let before = env.balance(&env.vault).await?;
    let s = env.agent_call(&agent, "spend", spend(&swap, 500 * MILLI, swap_out(500 * MILLI))).await?;
    assert!(s.ok(), "{}", s.line());
    assert_eq!(returned(&s), json!(true), "settled");
    assert_eq!(events(&s, "exposure_recorded").len(), 1);
    let after = env.balance(&env.vault).await?;
    let lost = before - after;
    println!("honest spend 0.5 NEAR  -> settled; vault balance moved by {} yocto (fee + gas)", lost);
    assert!(lost < 5 * MILLI, "proceeds must return to the vault; it lost {lost}");
    let ex = env.view("get_exposure", json!({ "target": swap })).await?;
    assert_eq!(ex["amount"], json!((500 * MILLI).to_string()));
    assert_eq!(ex["class_at_record"], "immutable_verified");
    let st = agent_state(&env, &agent).await?;
    assert_eq!(st["budgets"][0]["spent_today"], json!((500 * MILLI).to_string()));
    assert_eq!(st["budgets"][0]["reserved"], json!("0"));

    // Slippage beyond policy is refused by the adapter check.
    let s = env.agent_call(&agent, "spend", spend(&swap, 100 * MILLI, 90 * MILLI)).await?;
    assert_eq!(reason(&s), "ARUNA_SLIPPAGE_TOO_HIGH");
    assert_eq!(agent_state(&env, &agent).await?["refusals"].as_array().unwrap().len(), 1, "an agent-caused refusal counts");

    // Failed settlement: min_amount_out within policy but above what the target pays. The target
    // panics, the reservation is released, nothing is spent or recorded.
    let s = env.agent_call(&agent, "spend", spend(&swap, 100 * MILLI, 99_900 * MILLI / 1_000)).await?;
    assert_eq!(returned(&s), json!(false), "settlement reports failure: {}", s.line());
    let st = agent_state(&env, &agent).await?;
    assert_eq!(st["budgets"][0]["reserved"], json!("0"), "reservation released");
    assert_eq!(st["budgets"][0]["spent_today"], json!((500 * MILLI).to_string()), "nothing spent");
    assert_eq!(env.view("get_exposure", json!({ "target": swap })).await?["amount"], json!((500 * MILLI).to_string()));
    println!("target fails           -> reservation released, spent and exposure unchanged");

    // Reclassification: the registry now records the target as global_by_account. After a refresh,
    // the policy (max local_upgradeable) refuses it at execution time.
    // The slippage refusal above was agent-caused and counted; this one must not add to it.
    let counted = agent_state(&env, &agent).await?["refusals"].as_array().unwrap().len();
    env.classify(&env.swap, "global_by_account").await?;
    env.agent_call(&agent, "refresh_class", json!({ "target": swap })).await?;
    let s = env.agent_call(&agent, "spend", spend(&swap, 100 * MILLI, swap_out(100 * MILLI))).await?;
    assert_eq!(reason(&s), "ARUNA_RISK_CLASS_NOT_ALLOWED");
    assert_eq!(agent_state(&env, &agent).await?["refusals"].as_array().unwrap().len(), counted, "reclassification does not count");
    println!("target reclassified    -> {}", reason(&s));

    // Staleness: past MAX_CLASS_AGE the cache is refused until refreshed.
    env.classify(&env.swap, "immutable_verified").await?;
    env.agent_call(&agent, "refresh_class", json!({ "target": swap })).await?;
    env.worker.fast_forward(3_601).await?;
    let s = env.agent_call(&agent, "spend", spend(&swap, 100 * MILLI, swap_out(100 * MILLI))).await?;
    assert_eq!(reason(&s), "ARUNA_CLASS_STALE");
    env.agent_call(&agent, "refresh_class", json!({ "target": swap })).await?;
    let s = env.agent_call(&agent, "spend", spend(&swap, 100 * MILLI, swap_out(100 * MILLI))).await?;
    assert_eq!(returned(&s), json!(true), "a refresh clears staleness: {}", s.line());
    println!("cache past 3,600 blocks -> ARUNA_CLASS_STALE, cleared by refresh_class");
    Ok(())
}

#[tokio::test]
async fn parallel_spends_never_exceed_the_daily_cap() -> anyhow::Result<()> {
    let env = Env::new(8, ceiling("swap.test.near")).await?;
    let swap = env.swap.as_str().to_string();
    let cap = 2 * NEAR;
    let agent = add_agent(&env, "parallel", policy(&swap, cap)).await?;
    env.classify(&env.swap, "immutable_verified").await?;
    env.agent_call(&agent, "refresh_class", json!({ "target": swap })).await?;

    // Ten requests of 0.4 NEAR submitted at once: 4 NEAR against a 2 NEAR cap.
    let each = 400 * MILLI;
    let sent = env.agent_calls_parallel(&agent, "spend", (0..10).map(|_| spend(&swap, each, swap_out(each))).collect()).await?;
    for s in &sent {
        assert!(s.ok(), "every request must execute, not be rejected at submission: {}", s.line());
    }
    let settled = sent.iter().filter(|s| returned(s) == json!(true)).count();
    let capped = sent.iter().filter(|s| reason(s) == "ARUNA_DAILY_CAP_EXCEEDED").count();
    let st = agent_state(&env, &agent).await?;
    let spent: u128 = st["budgets"][0]["spent_today"].as_str().unwrap().parse()?;
    println!("10 parallel x 0.4 NEAR, cap 2 NEAR -> {settled} settled, {capped} refused at the cap, spent_today {spent}");
    assert!(spent <= cap, "spent {spent} exceeds cap {cap}");
    assert_eq!(settled as u128 * each, spent);
    assert_eq!(settled + capped, 10, "every request either settled or hit the cap: {:?}", sent.iter().map(|s| s.line()).collect::<Vec<_>>());
    assert_eq!(settled, 5);
    Ok(())
}

#[tokio::test]
async fn injected_agent_is_auto_disabled_and_only_the_owner_resumes() -> anyhow::Result<()> {
    let env = Env::new(5, ceiling("swap.test.near")).await?;
    let swap = env.swap.as_str().to_string();
    let agent = add_agent(&env, "injected", policy(&swap, NEAR)).await?;

    // A prompt-injected agent tries to send funds to an attacker's contract, repeatedly. The target is
    // outside its policy and has no recorded class, so each refusal weighs 8 (unknown).
    for i in 1..=3 {
        let s = env.agent_call(&agent, "spend", spend("attacker.test.near", 100 * MILLI, swap_out(100 * MILLI))).await?;
        assert!(s.ok(), "{}", s.line());
        println!("injected attempt {i}       -> {}{}", reason(&s), if events(&s, "agent_auto_disabled").is_empty() { "" } else { "  + agent_auto_disabled" });
        assert_eq!(events(&s, "agent_auto_disabled").len(), if i == 3 { 1 } else { 0 });
    }
    let st = agent_state(&env, &agent).await?;
    assert_eq!(st["status"], "Paused");
    assert_eq!(st["auto_disabled"], true);

    // Even an allowed target is now refused, with the auto-disable reason.
    let s = env.agent_call(&agent, "spend", spend(&swap, 100 * MILLI, swap_out(100 * MILLI))).await?;
    assert_eq!(reason(&s), "ARUNA_AGENT_AUTO_DISABLED");

    // The operator cannot undo it; the owner can.
    let r = env.company.call(&env.vault_ws(), "resume_agent").args_json(json!({ "public_key": agent.pk().to_string() })).deposit(near_workspaces::types::NearToken::from_yoctonear(1)).transact().await?;
    assert!(format!("{:?}", r.failures()).contains("ARUNA_OPERATOR_CANNOT_RESUME"));
    env.client.call(&env.vault_ws(), "resume_agent").args_json(json!({ "public_key": agent.pk().to_string() })).deposit(near_workspaces::types::NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert_eq!(agent_state(&env, &agent).await?["status"], "Active");
    println!("operator resume -> refused; owner resume -> Active");
    Ok(())
}

#[tokio::test]
async fn agent_keys_cannot_reach_callbacks_and_strangers_cannot_spend() -> anyhow::Result<()> {
    let env = Env::new(3, ceiling("swap.test.near")).await?;
    let swap = env.swap.as_str().to_string();
    let agent = add_agent(&env, "probe", policy(&swap, NEAR)).await?;
    for cb in ["cb_settle", "cb_refresh_class"] {
        let s = env.agent_call(&agent, cb, json!({})).await?;
        assert!(!s.ok() && s.error.to_string().contains("MethodNameMismatch"), "{cb}: {}", s.line());
        println!("agent key calls {cb:<17} -> MethodNameMismatch");
    }
    // An outside account calling spend is not an agent: authorization failure, it panics.
    let r = env.client.call(&env.vault_ws(), "spend").args_json(spend(&swap, MILLI, MILLI)).transact().await?;
    assert!(r.is_failure());
    Ok(())
}
