import { describe, expect, it } from "vitest";
import { Pool, quoteCoverage, Registry, type ReadTransport } from "../src/coverage/index.js";
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
