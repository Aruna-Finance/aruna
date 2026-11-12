import { describe, expect, it } from "vitest";
import type { AgentView, VaultView } from "@aruna/sdk";
import { overviewOf } from "./overview";

const agent = (o: Partial<AgentView> & { targets?: string[] } = {}): AgentView => ({
  publicKey: "ed25519:A", label: "bot", status: "Active", autoDisabled: false,
  policy: { maxPerTx: "1", dailyCap: "1", maxSlippageBps: 100, allowedTargets: o.targets ?? ["swap.t"], maxRiskClass: "local_upgradeable" },
  usage: null, key: null, cannot: [], ...o,
});
const view = (o: Partial<VaultView> = {}): VaultView => ({
  vault: "v", owner: "o", operator: null,
  ceiling: { maxPerTx: "1", dailyTotal: "1", maxRiskClass: "local_upgradeable", allowedTargets: ["swap.t", "drift.t"], agentAllowance: "1" },
  exposure: [{ target: "swap.t", amount: "300", classAtRecord: "local_upgradeable" }], fullAccessKeys: 0, agents: [agent()], unknownKeys: [], operatorCannot: [], ...o,
});

describe("overview totals", () => {
  it("counts active agents against agents that are not revoked", () => {
    const o = overviewOf(view({ agents: [agent(), agent({ publicKey: "B", status: "Paused" }), agent({ publicKey: "C", status: "Revoked" })] }));
    expect(o.agentsActive).toBe(1);
    expect(o.agentsTotal).toBe(2);
  });
  it("sums exposure per target and keeps the class recorded with it", () => {
    const o = overviewOf(view({ exposure: [{ target: "swap.t", amount: "300", classAtRecord: "none" }, { target: "swap.t", amount: "200", classAtRecord: "local_upgradeable" }] }));
    expect(o.exposureNear).toBe(500n);
    expect(o.targets.find((t) => t.target === "swap.t")).toMatchObject({ exposure: 500n, classAtRecord: "local_upgradeable", allowedBy: 1, inCeiling: true });
  });
  it("lists a ceiling target nobody has sent to, with no class and no exposure", () => {
    const t = overviewOf(view()).targets.find((x) => x.target === "drift.t");
    expect(t).toMatchObject({ exposure: 0n, classAtRecord: null, allowedBy: 0, inCeiling: true });
  });
  it("a revoked agent no longer counts as allowing a target", () => {
    expect(overviewOf(view({ agents: [agent({ status: "Revoked" })] })).targets.find((t) => t.target === "swap.t")?.allowedBy).toBe(0);
  });
  it("a vault version without exposure still renders its totals", () => {
    const o = overviewOf(view({ exposure: null }));
    expect(o.exposureNear).toBe(0n);
    expect(o.agentsTotal).toBe(1);
  });
});
