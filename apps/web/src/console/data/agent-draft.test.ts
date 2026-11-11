import { describe, expect, it } from "vitest";
import { policyProblem, type CeilingLike } from "../agent-actions";
import { defaultDraft, draftFromPolicy, draftToPolicy } from "./agent-draft";

const ceiling: CeilingLike = {
  maxPerTx: "500000000000000000000000",
  dailyTotal: "2000000000000000000000000",
  maxRiskClass: "local_upgradeable",
  allowedTargets: ["swap.testnet", "other.testnet"],
  tokens: [{ token: "near", maxPerTx: "500000000000000000000000", dailyTotal: "2000000000000000000000000" }],
};

describe("live agent draft", () => {
  it("converts NEAR and percent into yoctoNEAR strings and basis points", () => {
    const p = draftToPolicy({ maxTx: 0.1, cap: 0.4, slipPct: 0.5, maxClass: "local_upgradeable", targets: ["swap.testnet"] });
    expect(p).toEqual({ limits: [{ token: "near", maxPerTx: "100000000000000000000000", dailyCap: "400000000000000000000000" }], maxSlippageBps: 50, allowedTargets: ["swap.testnet"], maxRiskClass: "local_upgradeable" });
  });
  it("the default draft is inside the ceiling", () => {
    expect(policyProblem(draftToPolicy(defaultDraft(ceiling)), ceiling)).toBeNull();
  });
  it("the default draft shrinks to a small ceiling instead of exceeding it", () => {
    const small = { ...ceiling, maxPerTx: "50000000000000000000000", tokens: [{ token: "near", maxPerTx: "50000000000000000000000", dailyTotal: "200000000000000000000000" }] };
    const d = defaultDraft(small);
    expect(d.maxTx).toBe(0.05);
    expect(d.cap).toBe(0.2);
    expect(policyProblem(draftToPolicy(d), small)).toBeNull();
  });
  it("a limit above the ceiling is kept as typed and refused by field before signing", () => {
    const d = { ...defaultDraft(ceiling), maxTx: 0.6 };
    expect(policyProblem(draftToPolicy(d), ceiling)?.field).toBe("maxPerTx");
  });
  it("an empty or invalid amount becomes zero, which policyProblem refuses by field", () => {
    const p = draftToPolicy({ ...defaultDraft(ceiling), maxTx: NaN, cap: 0 });
    expect(p.limits[0]).toMatchObject({ maxPerTx: "0", dailyCap: "0" });
    expect(policyProblem(p, ceiling)?.field).toBe("maxPerTx");
  });
});

describe("editing an existing policy", () => {
  it("draftFromPolicy and draftToPolicy round-trip", () => {
    const p = draftToPolicy({ maxTx: 0.1, cap: 0.4, slipPct: 1, maxClass: "global_by_account", targets: ["swap.testnet"] });
    expect(draftToPolicy(draftFromPolicy(p))).toEqual(p);
  });
});
