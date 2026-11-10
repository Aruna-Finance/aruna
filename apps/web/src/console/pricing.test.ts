import { describe, expect, it } from "vitest";
import type { RiskClass } from "@/landing/lib/classifier-types";
import { policyPrice, tighteningOptions } from "./pricing";

const classes: Record<string, RiskClass> = {
  "vault.testnet": "immutable_verified",
  "dex.testnet": "local_upgradeable",
  "router.testnet": "global_by_account",
  "bridge.testnet": "unknown",
};
const classOf = (t: string) => classes[t];
const policy = { maxPerTx: 50, dailyCap: 100, maxSlippageBps: 50, allowedTargets: ["vault.testnet", "dex.testnet"], maxRiskClass: "local_upgradeable" as RiskClass };

describe("console pricing (mock)", () => {
  it("prices at the riskiest allowed class", () => {
    const p = policyPrice(policy, classOf);
    expect(p.priced && p.worst).toBe("local_upgradeable");
  });

  it("never prices a policy whose allowed targets include unknown", () => {
    const p = policyPrice({ ...policy, allowedTargets: ["bridge.testnet"], maxRiskClass: "unknown" }, classOf);
    expect(p.priced).toBe(false);
  });

  it("ignores targets above the policy's own class ceiling", () => {
    const p = policyPrice({ ...policy, allowedTargets: ["vault.testnet", "router.testnet"] }, classOf);
    expect(p.priced && p.worst).toBe("immutable_verified");
  });

  it("offers only changes that lower the premium, biggest saving first", () => {
    const o = tighteningOptions(policy, classOf);
    expect(o.length).toBeGreaterThan(0);
    for (const x of o) expect(x.after).toBeLessThan(x.before);
    expect(o.map((x) => x.saves)).toEqual([...o.map((x) => x.saves)].sort((a, b) => b - a));
  });
});
