import { describe, expect, it } from "vitest";
import { createVaultStore } from "./vault-mock";

describe("vault mock", () => {
  it("seeds the prototype's three agents under the owner's ceiling", () => {
    const v = createVaultStore().get();
    expect(v.agents.map((a) => a.id)).toEqual(["rebalancer", "market-maker", "yield-runner"]);
    const assigned = v.agents.reduce((s, a) => s + a.policy.dailyCap, 0);
    expect(assigned).toBeLessThanOrEqual(v.ceiling.dailyTotal);
  });

  it("lets the owner freeze and resume, and records an event", () => {
    const s = createVaultStore();
    s.setAgentStatus("rebalancer", "Paused", "owner");
    expect(s.get().agents[0].status).toBe("Paused");
    s.setAgentStatus("rebalancer", "Active", "owner");
    expect(s.get().agents[0].status).toBe("Active");
    expect(s.get().events[0].type).toBe("agent_status_changed");
  });

  it("refuses an operator that tries to resume", () => {
    const s = createVaultStore();
    expect(() => s.setAgentStatus("yield-runner", "Active", "operator")).toThrow(/ARUNA_NOT_OWNER/);
    expect(s.get().agents[2].status).toBe("Paused");
  });

  it("lets an operator tighten but not loosen a policy", () => {
    const s = createVaultStore();
    const p = s.get().agents[0].policy;
    s.applyPolicy("rebalancer", { ...p, dailyCap: 50 }, "operator");
    expect(s.get().agents[0].policy.dailyCap).toBe(50);
    expect(() => s.applyPolicy("rebalancer", { ...p, dailyCap: 500 }, "operator")).toThrow(/ARUNA_NOT_OWNER/);
  });

  it("notifies subscribers", () => {
    const s = createVaultStore();
    let n = 0;
    const off = s.subscribe(() => n++);
    s.setOperator(null);
    off();
    s.setOperator("opsdesk.testnet");
    expect(n).toBe(1);
  });
});

describe("vault mock: agents and funds", () => {
  const policy = { maxPerTx: 20, dailyCap: 50, maxSlippageBps: 30, allowedTargets: ["vault.testnet"], maxRiskClass: "immutable_verified" as const };

  it("adds an agent within the ceiling and refuses a taken or malformed id", () => {
    const s = createVaultStore();
    const a = s.addAgent({ id: "new-one", label: "New one", policy, deposit: 100, allowanceNear: 0.1 }, "owner");
    expect(a.status).toBe("Active");
    expect(s.get().agents).toHaveLength(4);
    expect(() => s.addAgent({ id: "new-one", label: "x", policy, deposit: 0, allowanceNear: 0.1 }, "owner")).toThrow(/ARUNA_INVALID_AGENT_ID/);
    expect(() => s.addAgent({ id: "Bad_Id", label: "x", policy, deposit: 0, allowanceNear: 0.1 }, "owner")).toThrow(/ARUNA_INVALID_AGENT_ID/);
  });

  it("refuses a policy that passes the owner's ceiling", () => {
    const s = createVaultStore();
    expect(() => s.addAgent({ id: "big", label: "Big", policy: { ...policy, maxPerTx: 999 }, deposit: 0, allowanceNear: 0.1 }, "owner")).toThrow(/ARUNA_CEILING_EXCEEDED/);
    expect(() => s.addAgent({ id: "big", label: "Big", policy: { ...policy, dailyCap: 600 }, deposit: 0, allowanceNear: 0.1 }, "owner")).toThrow(/ARUNA_CEILING_EXCEEDED/);
  });

  it("deposits for anyone but lets only the owner withdraw or change the allowance", () => {
    const s = createVaultStore();
    s.deposit("rebalancer", 50);
    expect(s.get().agents[0].balance).toBe(1250);
    expect(() => s.withdraw("rebalancer", 10, "operator")).toThrow(/ARUNA_NOT_OWNER/);
    expect(() => s.setAllowance("rebalancer", 1, "operator")).toThrow(/ARUNA_NOT_OWNER/);
    s.withdraw("rebalancer", 250, "owner");
    expect(s.get().agents[0].balance).toBe(1000);
    expect(() => s.withdraw("rebalancer", 99999, "owner")).toThrow(/ARUNA_INSUFFICIENT_BALANCE/);
    s.setAllowance("rebalancer", 0.5, "owner");
    expect(s.get().agents[0].allowanceNear).toBe(0.5);
  });

  it("lets an operator revoke a paused agent", () => {
    const s = createVaultStore();
    s.setAgentStatus("yield-runner", "Revoked", "operator");
    expect(s.get().agents[2].status).toBe("Revoked");
  });
});
