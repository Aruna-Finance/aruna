import type { RiskClass } from "@/landing/lib/classifier-types";
import { premium, type PricedClass } from "../landing/lib/premium-model";
import { CLASS_RANK, type Policy } from "./data/vault";

// MOCK pricing for the console, on top of the landing's assumption table. Replace with the SDK's simulate().

export type PolicyPrice =
  | { priced: false; reason: string }
  | { priced: true; total: number; limit: number; pctOfLimit: number; worst: RiskClass };

/** A policy is priced at the riskiest class among the targets it allows and that its own class ceiling admits. */
export function policyPrice(policy: Policy, classOf: (target: string) => RiskClass | undefined): PolicyPrice {
  const allowed = policy.allowedTargets
    .map(classOf)
    .filter((c): c is RiskClass => c !== undefined && CLASS_RANK[c] <= CLASS_RANK[policy.maxRiskClass]);
  const worst = allowed.reduce<RiskClass>((a, c) => (CLASS_RANK[c] > CLASS_RANK[a] ? c : a), "immutable_verified");
  if (worst === "unknown") {
    return { priced: false, reason: "The riskiest allowed target is unknown, so coverage is unavailable while it stays on the list. The agent can still run." };
  }
  const p = premium(worst as PricedClass, policy.dailyCap, policy.maxSlippageBps / 100);
  if (!p.priced) return { priced: false, reason: "Not priced." };
  return { priced: true, total: p.total, limit: p.maxExposure, pctOfLimit: p.pctOfExposure, worst };
}

export interface TighteningOption {
  id: "cap" | "slip" | "class";
  label: string;
  next: Policy;
  before: number;
  after: number;
  saves: number;
}

const BY_RANK: RiskClass[] = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"];

/** Ways to lower the premium, biggest saving first. Only changes that make the policy tighter. */
export function tighteningOptions(policy: Policy, classOf: (target: string) => RiskClass | undefined): TighteningOption[] {
  const base = policyPrice(policy, classOf);
  if (!base.priced) return [];
  const out: TighteningOption[] = [];
  const add = (id: TighteningOption["id"], label: string, next: Policy) => {
    const after = policyPrice(next, classOf);
    if (after.priced && after.total < base.total) {
      out.push({ id, label, next, before: base.total, after: after.total, saves: base.total - after.total });
    }
  };
  if (policy.dailyCap > 10) {
    const cap = Math.round(policy.dailyCap / 2);
    add("cap", `Halve the daily cap to ${cap.toLocaleString("en-US")} USDC`, { ...policy, dailyCap: cap, maxPerTx: Math.min(policy.maxPerTx, cap) });
  }
  if (policy.maxSlippageBps > 25) {
    const bps = Math.round(policy.maxSlippageBps / 2);
    add("slip", `Lower max slippage to ${(bps / 100).toFixed(2)}%`, { ...policy, maxSlippageBps: bps });
  }
  const r = CLASS_RANK[policy.maxRiskClass];
  if (r > 0) {
    const lower = BY_RANK[r - 1];
    const remaining = policy.allowedTargets.filter((t) => {
      const c = classOf(t);
      return c !== undefined && CLASS_RANK[c] <= r - 1;
    });
    if (remaining.length) add("class", `Stop touching ${policy.maxRiskClass} targets`, { ...policy, maxRiskClass: lower, allowedTargets: remaining });
  }
  return out.sort((a, b) => b.saves - a.saves);
}
