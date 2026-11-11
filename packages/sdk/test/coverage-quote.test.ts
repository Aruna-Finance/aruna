import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { admitsClass, Pool, quoteCoverage, Registry, RISK_CLASS_ORDER, type ReadTransport } from "../src/coverage/index.js";
import type { VaultView } from "../src/vault-view.js";

const KEY = "ed25519:AGENT";
const agent = (policy: Record<string, unknown>) => ({ publicKey: KEY, policy: { maxPerTx: "0", dailyCap: "0", ...policy } });
const vaultView = (a: unknown[]) => ({ agents: a }) as unknown as VaultView;

function deps(o: { record?: unknown; quote?: unknown; vault: VaultView }) {
  const poolCalls: Record<string, unknown>[] = [];
  const t: ReadTransport = {
    view: async <T>(contract: string, method: string, args: Record<string, unknown>) => {
      if (method === "get_class") return (o.record ?? null) as T;
      if (method === "quote") return (poolCalls.push(args), o.quote ?? null) as T;
      throw new Error(`unexpected ${method}`);
    },
  };
  return { poolCalls, d: { registry: new Registry({ registry: "reg", transport: t }), pool: new Pool({ pool: "pool", transport: t }), readVault: async () => o.vault } };
}
const req = { target: "t.testnet", vault: "v.testnet", agentPublicKey: KEY, token: "near", limit: "10", payoutRatioBps: 8000, windowBlocks: 100 };
const rec = { class: "global_by_account", resolved_code_hash: "H", upgrade_authority: "o.testnet" };
const q = { premium: "5", class: "global_by_account" };

describe("quoteCoverage", () => {
  it("passes the recorded class and the agent's daily cap to the pool and returns its quote untouched, with sources", async () => {
    const { d, poolCalls } = deps({ record: rec, quote: q, vault: vaultView([agent({ limits: [{ token: "near", maxPerTx: "1", dailyCap: "7" }] })]) });
    const r = await quoteCoverage(d, req);
    expect(r).toMatchObject({ ok: true, quote: q, inputs: { class: "global_by_account", dailyCap: "7", limit: "10", payoutRatioBps: 8000, windowBlocks: 100 } });
    expect(poolCalls).toEqual([{ class: "global_by_account", limit: "10", payout_ratio_bps: 8000, window_blocks: 100, daily_cap: "7" }]);
    if (r.ok) expect(r.inputs.dailyCapSource).toContain(KEY);
  });

  it("an FT is priced from that token's cap, not the NEAR cap", async () => {
    const { d, poolCalls } = deps({ record: rec, quote: q, vault: vaultView([agent({ limits: [{ token: "near", maxPerTx: "1", dailyCap: "7" }, { token: "usdc.testnet", maxPerTx: "1", dailyCap: "40" }] })]) });
    await quoteCoverage(d, { ...req, token: "usdc.testnet" });
    expect(poolCalls[0]?.daily_cap).toBe("40");
  });

  it("a token the agent has no budget for is a refusal, never a quote", async () => {
    const { d, poolCalls } = deps({ record: rec, quote: q, vault: vaultView([agent({ limits: [{ token: "near", maxPerTx: "1", dailyCap: "7" }] })]) });
    expect(await quoteCoverage(d, { ...req, token: "usdc.testnet" })).toMatchObject({ ok: false, reason: "no_daily_cap" });
    expect(poolCalls).toHaveLength(0);
  });

  it("a daily cap of zero is a refusal", async () => {
    const { d } = deps({ record: rec, quote: q, vault: vaultView([agent({ limits: [{ token: "near", maxPerTx: "1", dailyCap: "0" }] })]) });
    expect(await quoteCoverage(d, req)).toMatchObject({ ok: false, reason: "no_daily_cap" });
  });

  it("an unrecorded target is a refusal", async () => {
    const { d } = deps({ vault: vaultView([agent({})]) });
    expect(await quoteCoverage(d, req)).toMatchObject({ ok: false, reason: "no_class_record" });
  });

  it("a record without a resolved hash cannot be covered", async () => {
    const { d } = deps({ record: { class: "global_by_account", resolved_code_hash: null }, vault: vaultView([agent({})]) });
    expect(await quoteCoverage(d, req)).toMatchObject({ ok: false, reason: "not_coverable" });
  });

  it("an agent the vault does not have is a refusal", async () => {
    const { d } = deps({ record: rec, quote: q, vault: vaultView([]) });
    expect(await quoteCoverage(d, req)).toMatchObject({ ok: false, reason: "agent_not_found" });
  });

  it("a vault before per-token limits quotes NEAR from its legacy fields and refuses a token", async () => {
    const legacy = vaultView([agent({ maxPerTx: "1", dailyCap: "9" })]);
    const a = deps({ record: rec, quote: q, vault: legacy });
    await quoteCoverage(a.d, req);
    expect(a.poolCalls[0]?.daily_cap).toBe("9");
    expect(await quoteCoverage(deps({ record: rec, quote: q, vault: legacy }).d, { ...req, token: "usdc.testnet" })).toMatchObject({ ok: false, reason: "no_daily_cap" });
  });

  it("a class the pool will not insure is a refusal", async () => {
    const { d } = deps({ record: { ...rec, class: "unknown" }, quote: null, vault: vaultView([agent({ limits: [{ token: "near", maxPerTx: "1", dailyCap: "7" }] })]) });
    expect(await quoteCoverage(d, req)).toMatchObject({ ok: false, reason: "class_not_insurable" });
  });
});

describe("quoteCoverage with a proposed policy", () => {
  const onChain = () => vaultView([agent({ limits: [{ token: "near", maxPerTx: "1", dailyCap: "2000" }] })]);

  it("passes the proposed cap to the pool in place of the on-chain one, and returns the pool's quote untouched", async () => {
    const { d, poolCalls } = deps({ record: rec, quote: q, vault: onChain() });
    const r = await quoteCoverage(d, { ...req, proposed: { dailyCap: "1000" } });
    expect(poolCalls).toEqual([{ class: "global_by_account", limit: "10", payout_ratio_bps: 8000, window_blocks: 100, daily_cap: "1000" }]);
    expect(r).toMatchObject({ ok: true, quote: q, inputs: { dailyCap: "1000", proposed: true } });
    if (r.ok) expect(r.inputs.dailyCapSource).toMatch(/^proposed, not yet signed/);
  });

  it("a draft quote and the on-chain quote differ only in the cap sent to the pool", async () => {
    const { d, poolCalls } = deps({ record: rec, quote: q, vault: onChain() });
    const live = await quoteCoverage(d, req);
    await quoteCoverage(d, { ...req, proposed: { dailyCap: "1000" } });
    expect(live).toMatchObject({ ok: true, inputs: { dailyCap: "2000", proposed: false } });
    expect({ ...poolCalls[0], daily_cap: "1000" }).toEqual(poolCalls[1]);
  });

  it("a proposed cap of zero is a refusal naming the proposal, and the pool is not asked", async () => {
    const { d, poolCalls } = deps({ record: rec, quote: q, vault: onChain() });
    const r = await quoteCoverage(d, { ...req, proposed: { dailyCap: "0" } });
    expect(r).toMatchObject({ ok: false, reason: "no_daily_cap" });
    if (!r.ok) expect(r.detail).toContain("proposed");
    expect(poolCalls).toHaveLength(0);
  });

  it("a proposed riskiest class below the target's recorded class is a refusal before any vault read", async () => {
    let vaultReads = 0;
    const { d, poolCalls } = deps({ record: rec, quote: q, vault: onChain() });
    const r = await quoteCoverage({ ...d, readVault: async () => (vaultReads++, onChain()) }, { ...req, proposed: { maxRiskClass: "local_upgradeable" } });
    expect(r).toMatchObject({ ok: false, reason: "class_not_admitted" });
    expect([vaultReads, poolCalls.length]).toEqual([0, 0]);
  });

  it("a proposed riskiest class that admits the target prices it, and is reported with the inputs", async () => {
    const { d } = deps({ record: rec, quote: q, vault: onChain() });
    const r = await quoteCoverage(d, { ...req, proposed: { maxRiskClass: "global_by_account" } });
    expect(r).toMatchObject({ ok: true, inputs: { dailyCap: "2000", proposed: true, maxRiskClass: "global_by_account" } });
  });

  it("a proposal that is not a number or not a class is a programming error, not a quote", async () => {
    const { d } = deps({ record: rec, quote: q, vault: onChain() });
    await expect(quoteCoverage(d, { ...req, proposed: { dailyCap: "1.5" } })).rejects.toThrow(TypeError);
    await expect(quoteCoverage(d, { ...req, proposed: { maxRiskClass: "safe" as never } })).rejects.toThrow(TypeError);
  });
});

describe("admitsClass", () => {
  it("follows the vault's order: a policy admits its own class and every safer one", () => {
    expect(admitsClass("local_upgradeable", "immutable_verified")).toBe(true);
    expect(admitsClass("local_upgradeable", "local_upgradeable")).toBe(true);
    expect(admitsClass("local_upgradeable", "global_by_account")).toBe(false);
    expect(admitsClass("global_by_account", "unknown")).toBe(false);
    expect(admitsClass("unknown", "unknown")).toBe(true);
  });

  it("admits nothing it does not recognise", () => {
    expect(admitsClass("unknown", "upgradeable")).toBe(false);
  });

  it("RISK_CLASS_ORDER is the order of the contract's RiskClass enum", () => {
    const src = readFileSync(new URL("../../../contracts/common/src/class.rs", import.meta.url), "utf8");
    const body = /pub enum RiskClass \{([^}]*)\}/.exec(src)![1];
    const variants = [...body.matchAll(/^\s*([A-Z][A-Za-z]*),/gm)].map((m) => m[1].replace(/(?<!^)([A-Z])/g, "_$1").toLowerCase());
    expect(variants).toEqual([...RISK_CLASS_ORDER]);
  });
});
