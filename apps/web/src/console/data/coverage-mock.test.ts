import { describe, expect, it } from "vitest";
import { createCoverageStore, quoteCoverage } from "./coverage-mock";
import { stageOf } from "./coverage";

const base = { dailyCap: 100, slippagePct: 0.5, limit: 500, days: 30, payoutBps: 8000, utilization: 0.35 };

describe("coverage quote (mock)", () => {
  it("does not price unknown", () => {
    expect(quoteCoverage({ ...base, cls: "unknown" }).priced).toBe(false);
    expect(quoteCoverage({ ...base, cls: undefined }).priced).toBe(false);
  });

  it("caps the limit at what the policy can send in the period", () => {
    const q = quoteCoverage({ ...base, cls: "local_upgradeable", limit: 999_999 });
    expect(q.priced && q.limit).toBe(100 * 30);
  });

  it("prices a riskier class higher at the same limit", () => {
    const low = quoteCoverage({ ...base, cls: "immutable_verified" });
    const mid = quoteCoverage({ ...base, cls: "local_upgradeable" });
    const high = quoteCoverage({ ...base, cls: "global_by_account" });
    expect(low.total).toBeLessThan(mid.total);
    expect(mid.total).toBeLessThan(high.total);
  });
});

describe("coverage store (mock)", () => {
  it("shows the seeded policies in their stages", () => {
    const s = createCoverageStore().get();
    expect(s.policies.map((p) => p.id)).toEqual(["c-101", "c-102", "c-103"]);
    expect(stageOf(s.policies[0])).toBe("CoverageActive");
    expect(stageOf(s.policies[2])).toBe("WaitingPeriod");
  });

  it("buys on a target whose attestor is alive and starts the waiting period", () => {
    const store = createCoverageStore();
    const q = quoteCoverage({ ...base, cls: "immutable_verified", limit: 200 });
    const p = store.buy({ agent: "rebalancer", target: "vault.testnet", limit: 200, days: 30, payoutBps: 8000 }, q);
    expect(p.status).toBe("waiting");
    expect(store.get().policies).toHaveLength(4);
  });

  it("blocks a buy when the target's attestor has stopped reporting", () => {
    const store = createCoverageStore();
    const q = quoteCoverage({ ...base, cls: "global_by_account", limit: 200 });
    expect(() => store.buy({ agent: "market-maker", target: "router.testnet", limit: 200, days: 30, payoutBps: 8000 }, q)).toThrow(/ARUNA_ATTESTOR_STALE/);
  });

  it("blocks a buy that passes the concentration limit on one implementation", () => {
    const store = createCoverageStore();
    const q = quoteCoverage({ ...base, cls: "local_upgradeable", limit: 9000, days: 90 });
    expect(() => store.buy({ agent: "rebalancer", target: "dex.testnet", limit: 9000, days: 90, payoutBps: 8000 }, q)).toThrow(/ARUNA_CONCENTRATION_LIMIT/);
  });

  it("refuses an unpriced quote", () => {
    const store = createCoverageStore();
    const q = quoteCoverage({ ...base, cls: "unknown" });
    expect(() => store.buy({ agent: "rebalancer", target: "bridge.testnet", limit: 100, days: 30, payoutBps: 8000 }, q)).toThrow(/ARUNA_TARGET_NOT_COVERABLE/);
  });
});
