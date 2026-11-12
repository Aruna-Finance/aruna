import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { AgentView, VaultView } from "@aruna/sdk";
import { Pool, Registry, type QuoteDeps, type ReadTransport } from "@aruna/sdk/coverage";
import { nearToYocto } from "../fmt";
import { PriceTable } from "../ui/PriceTable";
import { priceTargets } from "../quote-live";
import { BLOCKS_PER_DAY, defaultLimit, describeQuote, PAYOUT_RATIO_BPS, WINDOW_BLOCKS, WINDOW_DAYS } from "./price";

const NEAR = (n: number) => nearToYocto(n);
const KEY = "ed25519:AGENT";
const agent = (cap: bigint): AgentView => ({
  publicKey: KEY, label: "bot", status: "Active", autoDisabled: false,
  policy: { maxPerTx: "1", dailyCap: cap.toString(), maxSlippageBps: 100, allowedTargets: ["swap.t"], maxRiskClass: "local_upgradeable", limits: [{ token: "near", maxPerTx: "1", dailyCap: cap.toString() }] },
  usage: null, key: null, cannot: [],
});
const view = (cap: bigint): VaultView => ({ vault: "v.testnet", owner: "o", operator: null, ceiling: null, exposure: null, fullAccessKeys: 0, agents: [agent(cap)], unknownKeys: [], operatorCannot: [] });

// A pool stand-in that behaves like the contract's quote: the payout it can reach is the smaller of the limit and
// cap x days x ratio, and the premium grows with it. It records every question it was asked.
function stack(cap: bigint, classOf = "local_upgradeable") {
  const asked: Record<string, string>[] = [];
  const t: ReadTransport = {
    view: async <T,>(_c: string, method: string, args: Record<string, unknown>) => {
      if (method === "get_class") return { class: classOf, resolved_code_hash: "H", upgrade_authority: null } as T;
      asked.push(args as Record<string, string>);
      const days = BigInt(WINDOW_DAYS + 1);
      const bound = (BigInt(args.daily_cap as string) * days * BigInt(PAYOUT_RATIO_BPS)) / 10_000n;
      const limit = BigInt(args.limit as string);
      const reachable = limit < bound ? limit : bound;
      return { class: classOf, premium: (reachable / 100n).toString(), reachable_payout: reachable.toString(), limit: limit.toString(), daily_cap: args.daily_cap, assumptions: { label: "ASSUMED" } } as T;
    },
  };
  const deps: QuoteDeps = { registry: new Registry({ registry: "reg", transport: t }), pool: new Pool({ pool: "pool", transport: t }), readVault: async () => view(cap) };
  return { deps, asked };
}
const base = { vault: "v.testnet", agentPublicKey: KEY, targets: ["swap.t"], draftMaxClass: "local_upgradeable" as const };

describe("window and default limit", () => {
  it("is thirty days at the pool's own blocks per day", () => {
    expect(WINDOW_BLOCKS).toBe(WINDOW_DAYS * BLOCKS_PER_DAY);
  });
  it("sits above what the cap can reach, at both 2 NEAR and 1 NEAR", () => {
    for (const cap of [NEAR(2), NEAR(1)]) {
      const reach = (cap * BigInt(WINDOW_DAYS + 1) * BigInt(PAYOUT_RATIO_BPS)) / 10_000n;
      expect(BigInt(defaultLimit(cap))).toBeGreaterThan(reach);
    }
  });
});

describe("price of a draft policy (AE3)", () => {
  it("lowering the draft cap from 2 NEAR to 1 NEAR asks the pool again through the proposed path, and the draft premium falls before anything is signed", async () => {
    const { deps, asked } = stack(NEAR(2));
    const [r] = await priceTargets(deps, { ...base, currentCapYocto: NEAR(2), draftCapYocto: NEAR(1) });
    const on = describeQuote(r.onChain);
    const dr = describeQuote(r.draft);
    if (on.kind !== "price" || dr.kind !== "price") throw new Error("expected prices");
    expect(Number(dr.premium)).toBeLessThan(Number(on.premium));
    expect(asked.map((q) => q.daily_cap)).toEqual([NEAR(2).toString(), NEAR(1).toString()]);
    expect(asked[0].limit).toBe(asked[1].limit);
    if (r.draft.ok) expect(r.draft.inputs.dailyCapSource).toContain("not yet signed");
  });

  it("after the tighten is signed, the on-chain quote equals the draft quote", async () => {
    const before = await priceTargets(stack(NEAR(2)).deps, { ...base, currentCapYocto: NEAR(2), draftCapYocto: NEAR(1) });
    const after = await priceTargets(stack(NEAR(1)).deps, { ...base, currentCapYocto: NEAR(1), draftCapYocto: NEAR(1) });
    expect(describeQuote(after[0].onChain)).toEqual(describeQuote(before[0].draft));
  });

  it("the payout it can reach is bound by the cap, not by the limit, at both caps", async () => {
    for (const cap of [NEAR(2), NEAR(1)]) {
      const [r] = await priceTargets(stack(cap).deps, { ...base, currentCapYocto: cap, draftCapYocto: cap });
      if (!r.onChain.ok) throw new Error("expected a quote");
      expect(BigInt(r.onChain.quote.reachable_payout)).toBeLessThan(BigInt(r.onChain.quote.limit));
    }
  });

  it("a draft cap of zero is an outcome with its reason, not a crash and not a free price", async () => {
    const { deps, asked } = stack(NEAR(2));
    const [r] = await priceTargets(deps, { ...base, currentCapYocto: NEAR(2), draftCapYocto: 0n });
    expect(describeQuote(r.draft)).toMatchObject({ kind: "refused", text: expect.stringContaining("daily cap of zero") });
    expect(describeQuote(r.onChain).kind).toBe("price");
    expect(asked).toHaveLength(1);
  });

  it("a draft class ceiling below the target's class refuses that target and leaves the on-chain price", async () => {
    const [r] = await priceTargets(stack(NEAR(2), "global_by_account").deps, { ...base, currentCapYocto: NEAR(2), draftCapYocto: NEAR(2), draftMaxClass: "local_upgradeable" });
    expect(describeQuote(r.draft)).toMatchObject({ kind: "refused", text: expect.stringContaining("class ceiling") });
    expect(describeQuote(r.onChain).kind).toBe("price");
  });
});

describe("price table", () => {
  it("labels the draft as not signed, says the numbers are assumed testnet numbers, and shows a refusal as text", async () => {
    const rows = await priceTargets(stack(NEAR(2)).deps, { ...base, targets: ["swap.t", "other.t"], currentCapYocto: NEAR(2), draftCapYocto: 0n });
    const out = renderToStaticMarkup(createElement(PriceTable, { rows, assumptions: "UNDERWRITING ASSUMPTIONS" }));
    expect(out).toContain("proposed, not yet signed");
    expect(out).toContain("Testnet, assumed numbers");
    expect(out).toContain("UNDERWRITING ASSUMPTIONS");
    expect(out).toContain("daily cap of zero");
  });
  it("says so when the draft allows no target", () => {
    expect(renderToStaticMarkup(createElement(PriceTable, { rows: [], assumptions: null }))).toContain("nothing to price");
  });
});
