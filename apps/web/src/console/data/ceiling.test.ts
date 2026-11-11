import { describe, expect, it } from "vitest";
import { ceilingEditProblem, ceilingToRaw, type CurrentCeiling } from "./ceiling";
import type { TargetOption } from "./factory";

const t = (target: string, cls: TargetOption["class"]): TargetOption => ({ target, class: cls, frozen: false, classifiedAtBlock: 1 });
const current: CurrentCeiling = {
  maxPerTx: "500000000000000000000000",
  dailyTotal: "2000000000000000000000000",
  maxRiskClass: "local_upgradeable",
  allowedTargets: ["a.testnet"],
  agentAllowance: "1000000000000000000000000",
  tokens: [
    { token: "near", maxPerTx: "500000000000000000000000", dailyTotal: "2000000000000000000000000" },
    { token: "usdc.testnet", maxPerTx: "5", dailyTotal: "50" },
  ],
};
const edit = { maxTx: 0.3, daily: 1, allowance: 0.5, targets: [t("a.testnet", "local_upgradeable"), t("b.testnet", "global_by_account")] };

describe("ceiling edit", () => {
  it("builds the raw shape, with the class of the riskiest chosen target", () => {
    expect(ceilingToRaw(current, edit)).toMatchObject({
      tokens: [{ token: "near", max_per_tx: "300000000000000000000000", daily_total: "1000000000000000000000000" }, { token: { ft: "usdc.testnet" }, max_per_tx: "5", daily_total: "50" }],
      max_risk_class: "global_by_account",
      allowed_targets: ["a.testnet", "b.testnet"],
      agent_allowance: "500000000000000000000000",
    });
  });
  it("keeps fungible-token limits it did not edit", () => {
    expect(ceilingToRaw(current, edit).tokens).toHaveLength(2);
  });
  it("works for a vault version that lists only NEAR", () => {
    expect(ceilingToRaw({ ...current, tokens: undefined }, edit).tokens).toHaveLength(1);
  });
  it("refuses zero, inverted, empty and missing values with a message", () => {
    expect(ceilingEditProblem({ ...edit, maxTx: 0 })).toMatch(/per transaction/);
    expect(ceilingEditProblem({ ...edit, daily: 0 })).toMatch(/Daily/);
    expect(ceilingEditProblem({ ...edit, maxTx: 2, daily: 1 })).toMatch(/cannot exceed/);
    expect(ceilingEditProblem({ ...edit, allowance: 0 })).toMatch(/allowance/);
    expect(ceilingEditProblem({ ...edit, targets: [] })).toMatch(/at least one/);
    expect(() => ceilingToRaw(current, { ...edit, targets: [] })).toThrow();
  });
});
