// The coverage loop on testnet, end to end (plan U9, R28–R30). Run after
// scripts/testnet-coverage-setup.sh:
//   node examples/coverage-demo.ts
//   node examples/coverage-demo.ts --resume <near coverage id> <usdc coverage id> <agent label>
//     continues at step 7 after a run whose target change already happened (each redeploy of the
//     target's code by account costs its owner about 12 NEAR, so a rerun should not repeat it)
// It fails loudly, with a non-zero exit, if any step does not produce its expected result.
//
//  1. the vault is immutable_verified; the operator adds an agent with a tight daily cap
//  2. two quotes for the same coverage, differing only in daily_cap: the tight one is cheaper
//  3. the attestor observes the target (and sends its heartbeat)
//  4. the client buys coverage in NEAR and in the test USDC, at the tight price
//  5. after the waiting period the agent swaps NEAR and USDC on the target
//  6. the target's owner republishes its code BY ACCOUNT: the target's code_hash does not change
//  7. the attestor sees the change and files a signed report; the freeze is pushed; a spend is refused
//  8. a claim during the challenge window is refused; after it, both claims pay by the formula
//
// Testnet only. Every economic number is a labelled assumption (aruna_common::params). The attestor
// and the arbiter are trust assumptions, both run by Aruna here.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Account } from "near-api-js";
import { fetchViewTransport, OwnerCoverage, Pool, quoteCoverage, Registry } from "@aruna/sdk/coverage";
import { nearApiTransport } from "@aruna/sdk/vault";

const PARENT = process.env.ARUNA_TESTNET_ACCOUNT ?? "arunafi.testnet";
const VAULT = `demo4.factory2.${PARENT}`;
process.env.ARUNA_VAULT = VAULT;
const { agentAccount, agentKey, explorer, fmt, legacyAccount, legacyKey, near, provider, RPC, send, view } = await import("./lib.ts");

const REGISTRY = `registry2.${PARENT}`;
const POOL = `pool2.${PARENT}`;
const USDC = `usdc.${PARENT}`;
const TARGET = `drift-target.${PARENT}`;
const DOWNER = `drift-owner.${PARENT}`;
const ATTESTOR_A = `attestor-a.${PARENT}`;
const CLIENT = `demo-client.${PARENT}`;
const COMPANY = `demo-company.${PARENT}`;
const WAITING = 120;
const WINDOW = 300;
const COVER_WINDOW = 43_200; // blocks; touches 2 UTC days under BLOCKS_PER_DAY
const root = fileURLToPath(new URL("..", import.meta.url));

// Coverage goes through @aruna/sdk/coverage: reads are keyless, the purchase and the claim are the
// owner's, signed here with the client's own key.
const reads = fetchViewTransport({ network: "testnet" });
const registry = new Registry({ registry: REGISTRY, transport: reads });
const pool = new Pool({ pool: POOL, transport: reads });
const ownerCoverage = new OwnerCoverage({ pool: POOL, transport: nearApiTransport({ signerId: CLIENT, privateKey: legacyKey(CLIENT), rpcUrl: RPC }) });

let step = 0;
const say = (s: string) => console.log(`\n${++step}. ${s}`);
const fail: (s: string) => never = (s) => {
  console.error(`\nFAILED at step ${step}: ${s}`);
  process.exit(1);
};
const expect = (cond: unknown, s: string) => {
  if (!cond) fail(s);
};
const usdc = (units: string | bigint) => `${(Number(BigInt(units)) / 1e6).toFixed(2)} tUSDC`;

async function height(): Promise<number> {
  return (await provider.viewBlock({ finality: "final" })).header.height;
}
async function waitUntil(block: number, why: string) {
  for (;;) {
    const h = await height();
    if (h >= block) return;
    process.stdout.write(`\r   waiting for ${why}: block ${h} / ${block}   `);
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
async function callAs(acc: Account, contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n, tgas = 100n) {
  const res = await acc.callFunctionRaw({ contractId, methodName, args, deposit, gas: tgas * 10n ** 12n, waitUntil: "FINAL" });
  const status = res.status as { SuccessValue?: string; Failure?: unknown };
  if (status.Failure !== undefined) fail(`${methodName} on ${contractId}: ${JSON.stringify(status.Failure)}`);
  const logs = res.receipts_outcome.flatMap((r) => r.outcome.logs);
  const events = logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice(11)));
  const raw = Buffer.from(status.SuccessValue ?? "", "base64").toString();
  return { tx: res.transaction.hash as string, value: raw ? JSON.parse(raw) : null, events };
}
async function viewOf<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}
function attestor(...args: string[]): string {
  return execFileSync("node", ["packages/attestor/dist/index.js", ...args], { cwd: root, encoding: "utf8" });
}
/** A call signed by the registry owner and classifier, PARENT, whose key is in the near-cli-rs keychain. */
function asParent(contract: string, method: string, args: unknown) {
  execFileSync("near", ["contract", "call-function", "as-transaction", contract, method, "json-args", JSON.stringify(args), "prepaid-gas", "50 Tgas", "attached-deposit", "0 NEAR", "sign-as", PARENT, "network-config", "testnet", "sign-with-keychain", "send"], { stdio: "ignore" });
}
function cli(...args: string[]): string {
  return execFileSync("node", ["packages/cli/dist/index.js", ...args], { cwd: root, encoding: "utf8" });
}

const resume = process.argv[2] === "--resume" ? [Number(process.argv[3]), Number(process.argv[4])] : null;
// --resume <near> <usdc> <label>: the agent the resumed coverage names.
const AGENT_LABEL = resume ? (process.argv[5] ?? "covered") : `covered-${Date.now()}`;
const agentPk = agentKey(AGENT_LABEL, true).getPublicKey().toString();
const client = legacyAccount(CLIENT);
const company = legacyAccount(COMPANY);
const anyone = client;

// eslint-disable-next-line prefer-const
let agent: Account;
let nearCov: { id: number; waiting_period_ends: number; limit: string; premium_paid: string; policy_version: number };
let usdcCov: { id: number; limit: string; premium_paid: string };
if (resume) {
  agent = agentAccount(AGENT_LABEL);
  nearCov = await viewOf(POOL, "get_coverage", { id: resume[0] });
  usdcCov = await viewOf(POOL, "get_coverage", { id: resume[1] });
  step = 6;
  console.log(`resuming with coverage #${nearCov.id} (NEAR) and #${usdcCov.id} (USDC); the target's change already happened`);
} else {
  // 1 ---------------------------------------------------------------------------------------------
  say(`vault ${VAULT}`);
  const cls = JSON.parse(cli("classify", VAULT, "--network", "testnet"));
  console.log(`   class ${cls.class}, full-access keys ${cls.evidence.fullAccessKeyCount}, resolved ${cls.evidence.resolvedCodeHash}`);
  expect(cls.class === "immutable_verified", "the vault must classify immutable_verified");
  // A fresh agent per run, so the run never depends on what an earlier run spent today. The previous
  // demo agents are revoked first, which frees their share of the ceiling.
  for (const [pk, a] of await view<[string, { label: string; status: string }][]>("get_agents")) {
    if (a.label.startsWith("covered") && a.status !== "Revoked") {
      const r = await send(company, "revoke_agent", { public_key: pk }, "0", 30n * 10n ** 12n);
      console.log(`   the operator revoked the previous demo agent ${a.label}  ${explorer(r.tx)}`);
    }
  }
  const policy = {
    limits: [
      { token: "near", max_per_tx: near("0.2"), daily_cap: near("0.2") },
      { token: { ft: USDC }, max_per_tx: "5000000", daily_cap: "2000000" },
    ],
    max_slippage_bps: 100,
    allowed_targets: [TARGET],
    max_risk_class: "global_by_account",
  };
  {
    const r = await send(company, "add_agent", { public_key: agentPk, label: AGENT_LABEL, policy }, "1", 30n * 10n ** 12n);
    console.log(`   the operator added agent "${AGENT_LABEL}" (${agentPk})  ${explorer(r.tx)}`);
  }

  // A previous run leaves the target frozen by its verified report. Its new code is classified again
  // and the registry owner lifts the freeze; the vault picks that up at its next refresh_class.
  const rec = await viewOf<{ frozen: boolean } | null>(REGISTRY, "get_class", { target: TARGET });
  if (rec?.frozen) {
    asParent(REGISTRY, "set_class", JSON.parse(execFileSync("node", ["fixtures/tools.mjs", "class-args", TARGET], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })));
    asParent(REGISTRY, "lift_freeze", { target: TARGET });
    expect(!(await viewOf<{ frozen: boolean }>(REGISTRY, "get_class", { target: TARGET })).frozen, "the freeze must be lifted");
    console.log(`   ${TARGET} was frozen by an earlier verified report: reclassified and the freeze lifted by the registry owner`);
  }

  // 2 ---------------------------------------------------------------------------------------------
  say("two quotes, same coverage, differing only in the agent's daily cap");
  const C = near("1");
  const quote = async (cap: string) => (await pool.quote({ class: "global_by_account", limit: C, payoutRatioBps: 8_000, windowBlocks: COVER_WINDOW, dailyCap: cap })) ?? fail("the pool would not quote");
  const loose = await quote(near("1"));
  const tight = await quote(near("0.2"));
  console.log(`   C ${fmt(C)}, ratio 80%, window touching ${tight.days} UTC days; ${loose.assumptions.label}`);
  console.log(`   daily cap 1.0 NEAR -> reachable ${fmt(loose.reachable_payout)}, premium ${fmt(loose.premium)}`);
  console.log(`   daily cap 0.2 NEAR -> reachable ${fmt(tight.reachable_payout)}, premium ${fmt(tight.premium)}`);
  expect(BigInt(tight.premium) < BigInt(loose.premium), "the two premiums must differ, tight below loose (R29)");

  // 3 ---------------------------------------------------------------------------------------------
  say(`the attestor ${ATTESTOR_A} observes ${TARGET}`);
  console.log(attestor("watch", "--attestor", ATTESTOR_A, "--registry", REGISTRY, "--targets", TARGET, "--once").trim().replace(/^/gm, "   "));
  expect(await viewOf<boolean>(REGISTRY, "heartbeat_fresh", { target: TARGET }), "the assigned attestor's heartbeat must be fresh");

  // 4 ---------------------------------------------------------------------------------------------
  say("the client buys coverage at the tight price, in NEAR and in the test USDC");
  const shape = (limit: string) => ({ limit, payoutRatioBps: 8_000, windowBlocks: COVER_WINDOW });
  const request = (limit: string) => ({ vault: VAULT, agentPublicKey: agentPk, target: TARGET, ...shape(limit) });
  // The price comes from the SDK's composition of the registry's class, this agent's daily cap in the
  // vault policy and the pool's quote; it must equal the tight quote of step 2.
  const nearQuote = await quoteCoverage({ registry, pool, network: "testnet" }, { target: TARGET, vault: VAULT, agentPublicKey: agentPk, token: "near", ...shape(C) });
  if (!nearQuote.ok) fail(`NEAR quote refused: ${nearQuote.reason} - ${nearQuote.detail}`);
  expect(nearQuote.quote.premium === tight.premium, "the SDK quote must equal the pool's quote at the agent's cap");
  const nearBuy = await ownerCoverage.buy({ request: request(C), token: "near", maxPremium: nearQuote.quote.premium });
  if (!nearBuy.ok) fail(`NEAR purchase refused: ${nearBuy.reason}`);
  nearCov = nearBuy.coverage as unknown as typeof nearCov;
  expect(nearBuy.premium === tight.premium, "the owner must be charged the quoted premium");
  console.log(`   NEAR coverage #${nearCov.id}: C ${fmt(nearCov.limit)}, premium ${fmt(nearCov.premium_paid)} paid by the owner, policy version ${nearCov.policy_version}  ${explorer(nearBuy.tx)}`);
  const usdcQuote = await quoteCoverage({ registry, pool, network: "testnet" }, { target: TARGET, vault: VAULT, agentPublicKey: agentPk, token: USDC, ...shape("10000000") });
  if (!usdcQuote.ok) fail(`USDC quote refused: ${usdcQuote.reason} - ${usdcQuote.detail}`);
  const usdcBuy = await ownerCoverage.buy({ request: request("10000000"), token: USDC, maxPremium: usdcQuote.quote.premium });
  if (!usdcBuy.ok) fail(`USDC purchase refused: ${usdcBuy.reason}`);
  usdcCov = usdcBuy.coverage as unknown as typeof usdcCov;
  console.log(`   USDC coverage #${usdcCov.id}: C ${usdc(usdcCov.limit)}, premium ${usdc(usdcCov.premium_paid)}  ${explorer(usdcBuy.tx)}`);

  // 5 ---------------------------------------------------------------------------------------------
  say("after the waiting period, the agent swaps on the target");
  await waitUntil(nearCov.waiting_period_ends + 1, "the waiting period");
  agent = agentAccount(AGENT_LABEL);
  await send(agent, "refresh_class", { target: TARGET });
  const s1 = await send(agent, "spend", { adapter: "swap", target: TARGET, amount: near("0.1"), min_amount_out: near("0.099") });
  expect(s1.value === true, `NEAR swap: ${JSON.stringify(s1.value)}`);
  const s2 = await send(agent, "spend", { adapter: "ft_swap", target: TARGET, amount: "1000000", min_amount_out: "990000", token: USDC }, "0", 150n * 10n ** 12n);
  expect(s2.value === true, `USDC swap: ${JSON.stringify(s2.value)}`);
  console.log(`\n   swapped 0.1 NEAR  ${explorer(s1.tx)}\n   swapped 1.00 tUSDC  ${explorer(s2.tx)}`);

  // 6 ---------------------------------------------------------------------------------------------
  say(`${DOWNER} republishes the target's code by account; nothing touches ${TARGET}`);
  console.log(attestor("watch", "--attestor", ATTESTOR_A, "--registry", REGISTRY, "--targets", TARGET, "--once").trim().replace(/^/gm, "   "));
  const before = await provider.viewAccount({ accountId: TARGET });
  const v = await viewOf<string>(TARGET, "version");
  const next = v === "drift-target-v1" ? "v2" : "v1";
  const owner = legacyAccount(DOWNER);
  const dep = await owner.deployGlobalContract(readFileSync(`${root}fixtures/wasm/drift-target/${next}/drift_target.wasm`), "accountId");
  // Code published by account reaches the accounts using it within a few blocks.
  let v2 = v;
  for (let i = 0; i < 30 && v2 === v; i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    v2 = await viewOf<string>(TARGET, "version");
  }
  const after = await provider.viewAccount({ accountId: TARGET });
  console.log(`   version() ${v} -> ${v2}  ${explorer(dep.transaction.hash)}`);
  console.log(`   view_account.code_hash ${before.code_hash} -> ${after.code_hash}  (unchanged: the field everyone monitors)`);
  expect(v2 !== v && before.code_hash === after.code_hash, "the code must change while code_hash does not (R30)");

}

// 7 ---------------------------------------------------------------------------------------------
say("the attestor sees it and files a signed report; the freeze reaches the vault");
const out = attestor("watch", "--attestor", ATTESTOR_A, "--registry", REGISTRY, "--targets", TARGET, "--once");
console.log(out.trim().replace(/^/gm, "   "));
const reportId = Number(/report (\d+)/.exec(out)?.[1] ?? fail("the attestor filed no report"));
const rep = await viewOf<{ state: string; report: { changed_at_block: number } }>(REGISTRY, "get_report", { id: reportId });
console.log(`   report ${reportId}: ${rep.state}, changed_at_block ${rep.report.changed_at_block} (the attestor's claim)`);
const push = await callAs(anyone, REGISTRY, "push_freeze", { target: TARGET, from: 0, limit: 10 }, 0n, 150n);
console.log(`   push_freeze  ${explorer(push.tx)}`);
await new Promise((r) => setTimeout(r, 4_000));
const refused = await send(agent, "spend", { adapter: "swap", target: TARGET, amount: near("0.05"), min_amount_out: near("0.0495") });
const reason = (refused.value as { reason?: string })?.reason;
console.log(`   the agent's next spend: ${reason}`);
expect(reason === "ARUNA_TARGET_FROZEN", "the next spend must be refused as frozen");

// 8 ---------------------------------------------------------------------------------------------
say("claims: refused while the challenge window is open, paid after it");
const claim = async (id: number) => {
  await ownerCoverage.claim({ coverageId: id, reportId });
  const c = (await pool.coverage(id)) ?? fail(`coverage ${id} vanished`);
  return c.claims[c.claims.length - 1]!;
};
const early = await claim(nearCov.id);
console.log(`   claim on #${nearCov.id} now: ${early.outcome}`);
expect(early.outcome === "challenge window still open", "an early claim must be refused");
const reportedAt = (await viewOf<{ reported_at_block: number }>(REGISTRY, "get_report", { id: reportId })).reported_at_block;
await waitUntil(reportedAt + WINDOW + 1, "the challenge window");
const beforeBal = BigInt((await provider.viewAccount({ accountId: CLIENT })).amount);
const paidNear = await claim(nearCov.id);
const paidUsdc = await claim(usdcCov.id);
const afterBal = BigInt((await provider.viewAccount({ accountId: CLIENT })).amount);
console.log(`\n   NEAR claim: ${paidNear.outcome}, ${fmt(paidNear.paid)} = min(0.1 NEAR recorded before the change x 80%, C)`);
console.log(`   USDC claim: ${paidUsdc.outcome}, ${usdc(paidUsdc.paid)} = min(1.00 tUSDC x 80%, C)`);
console.log(`   the client's NEAR balance rose by ${fmt(afterBal - beforeBal)} (claims were sent by the client, who paid their gas)`);
expect(paidNear.outcome === "paid" && BigInt(paidNear.paid) === BigInt(near("0.08")), "the NEAR claim must pay 0.08 NEAR");
expect(paidUsdc.outcome === "paid" && paidUsdc.paid === "800000", "the USDC claim must pay 0.80 tUSDC");
console.log("\nThe loop ran end to end.");
