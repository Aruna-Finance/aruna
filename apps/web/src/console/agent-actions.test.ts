import { describe, expect, it } from "vitest";
import type { Policy } from "@aruna/sdk/vault";
import { availability, isTighter, policyProblem, type CeilingLike } from "./agent-actions";

const active = { status: "Active", autoDisabled: false } as const;
const auto = { status: "Paused", autoDisabled: true } as const;
const manual = { status: "Paused", autoDisabled: false } as const;
const revoked = { status: "Revoked", autoDisabled: false } as const;
const reason = (a: ReturnType<typeof availability>) => (a.enabled ? null : a.reason);

describe("availability (AE1, R20, R21)", () => {
  it("the operator cannot resume an auto-disabled agent, and says why", () => {
    expect(reason(availability("operator", "resume", auto))).toBe("only the owner can resume an auto-disabled agent");
  });
  it("the owner can resume it", () => {
    expect(availability("owner", "resume", auto)).toEqual({ enabled: true });
    expect(availability("owner", "resume", manual)).toEqual({ enabled: true });
  });
  it("the operator cannot resume any agent", () => {
    expect(availability("operator", "resume", manual).enabled).toBe(false);
  });
  it("the operator cannot loosen, withdraw, change the ceiling or the operator, each with a reason", () => {
    for (const a of ["loosen", "withdraw", "set_ceiling", "set_operator"] as const) {
      expect(availability("operator", a, active).enabled).toBe(false);
      expect(reason(availability("operator", a, active))).toMatch(/^only the owner/);
      expect(availability("owner", a, active).enabled).toBe(true);
    }
  });
  it("both roles can pause, revoke and tighten an active agent", () => {
    for (const role of ["owner", "operator"] as const) for (const a of ["pause", "revoke", "tighten"] as const) expect(availability(role, a, active).enabled).toBe(true);
  });
  it("a paused agent cannot be paused again, and a revoked agent allows nothing but reading", () => {
    expect(availability("owner", "pause", manual).enabled).toBe(false);
    for (const a of ["pause", "resume", "revoke", "tighten", "loosen"] as const) expect(availability("owner", a, revoked).enabled).toBe(false);
  });
  it("an active agent cannot be resumed", () => {
    expect(reason(availability("owner", "resume", active))).toBe("this agent is not paused");
  });
});

const ceiling: CeilingLike = {
  maxPerTx: "500",
  dailyTotal: "2000",
  maxRiskClass: "local_upgradeable",
  allowedTargets: ["swap.testnet"],
  tokens: [{ token: "near", maxPerTx: "500", dailyTotal: "2000" }],
};
const ok: Policy = { limits: [{ token: "near", maxPerTx: "100", dailyCap: "400" }], maxSlippageBps: 100, allowedTargets: ["swap.testnet"], maxRiskClass: "local_upgradeable" };

describe("policyProblem (refused before signing, field named)", () => {
  it("accepts a policy inside the ceiling", () => expect(policyProblem(ok, ceiling)).toBeNull());
  it("names maxPerTx, dailyCap, allowedTargets and maxRiskClass", () => {
    expect(policyProblem({ ...ok, limits: [{ token: "near", maxPerTx: "501", dailyCap: "600" }] }, ceiling)?.field).toBe("maxPerTx");
    expect(policyProblem({ ...ok, limits: [{ token: "near", maxPerTx: "100", dailyCap: "2001" }] }, ceiling)?.field).toBe("dailyCap");
    expect(policyProblem({ ...ok, allowedTargets: ["other.testnet"] }, ceiling)?.field).toBe("allowedTargets");
    expect(policyProblem({ ...ok, maxRiskClass: "global_by_account" }, ceiling)?.field).toBe("maxRiskClass");
  });
  it("refuses a token the ceiling does not list, no limits, and no targets", () => {
    expect(policyProblem({ ...ok, limits: [{ token: "usdc.testnet", maxPerTx: "1", dailyCap: "1" }] }, ceiling)?.field).toBe("limits");
    expect(policyProblem({ ...ok, limits: [] }, ceiling)?.field).toBe("limits");
    expect(policyProblem({ ...ok, allowedTargets: [] }, ceiling)?.field).toBe("allowedTargets");
  });
  it("refuses a per-transaction limit above the daily limit, and bad slippage", () => {
    expect(policyProblem({ ...ok, limits: [{ token: "near", maxPerTx: "300", dailyCap: "200" }] }, ceiling)?.field).toBe("maxPerTx");
    expect(policyProblem({ ...ok, maxSlippageBps: 10_001 }, ceiling)?.field).toBe("maxSlippageBps");
  });
  it("falls back to the NEAR fields when the ceiling has no per-token list", () => {
    expect(policyProblem(ok, { ...ceiling, tokens: undefined })).toBeNull();
  });
});

describe("isTighter (what an operator may do)", () => {
  it("accepts lower limits, fewer targets, a lower class and less slippage, and no change", () => {
    expect(isTighter(ok, ok)).toBe(true);
    expect(isTighter(ok, { ...ok, limits: [{ token: "near", maxPerTx: "50", dailyCap: "300" }], maxSlippageBps: 50, maxRiskClass: "immutable_verified" })).toBe(true);
  });
  it("refuses a higher limit, a new target, a higher class, more slippage, or a token the policy did not have", () => {
    expect(isTighter(ok, { ...ok, limits: [{ token: "near", maxPerTx: "101", dailyCap: "400" }] })).toBe(false);
    expect(isTighter(ok, { ...ok, limits: [{ token: "near", maxPerTx: "100", dailyCap: "401" }] })).toBe(false);
    expect(isTighter(ok, { ...ok, allowedTargets: ["swap.testnet", "x.testnet"] })).toBe(false);
    expect(isTighter(ok, { ...ok, maxRiskClass: "global_by_account" })).toBe(false);
    expect(isTighter(ok, { ...ok, maxSlippageBps: 101 })).toBe(false);
    expect(isTighter(ok, { ...ok, limits: [...ok.limits, { token: "usdc.testnet", maxPerTx: "1", dailyCap: "1" }] })).toBe(false);
  });
});
