import type { Policy } from "@aruna/sdk/vault";
import { nearToYocto } from "../fmt";
import type { CeilingLike } from "../agent-actions";

// The live agent wizard edits a draft in NEAR and percent, like the sample wizard does in USDC. This turns it into
// the SDK's Policy (yoctoNEAR strings, basis points). Nothing is clamped here: a value outside the ceiling is kept as
// typed so policyProblem can refuse it by field name before anything is signed.

export interface LiveDraft {
  maxTx: number;
  cap: number;
  slipPct: number;
  maxClass: Policy["maxRiskClass"];
  targets: string[];
}

export function draftToPolicy(d: LiveDraft): Policy {
  const ok = (n: number) => (Number.isFinite(n) && n > 0 ? nearToYocto(n).toString() : "0");
  return {
    limits: [{ token: "near", maxPerTx: ok(d.maxTx), dailyCap: ok(d.cap) }],
    maxSlippageBps: Math.round((Number.isFinite(d.slipPct) ? d.slipPct : 0) * 100),
    allowedTargets: d.targets,
    maxRiskClass: d.maxClass,
  };
}

export const yoctoToNum = (y: string) => Number(BigInt(y) / 10n ** 20n) / 10_000;

/** The draft that edits an agent's current policy. Only NEAR limits are editable, as in the wizard. */
export function draftFromPolicy(p: Policy): LiveDraft {
  const near = p.limits.find((l) => l.token === "near");
  return {
    maxTx: near ? yoctoToNum(near.maxPerTx) : 0,
    cap: near ? yoctoToNum(near.dailyCap) : 0,
    slipPct: p.maxSlippageBps / 100,
    maxClass: p.maxRiskClass,
    targets: p.allowedTargets,
  };
}

/** A starting draft inside the ceiling: small limits, the first allowed target, the ceiling's own class. */
export function defaultDraft(c: CeilingLike): LiveDraft {
  const near = c.tokens?.find((t) => t.token === "near");
  const perTx = yoctoToNum(near?.maxPerTx ?? c.maxPerTx);
  const daily = yoctoToNum(near?.dailyTotal ?? c.dailyTotal);
  return {
    maxTx: Math.min(0.1, perTx),
    cap: Math.min(0.4, daily),
    slipPct: 1,
    maxClass: c.maxRiskClass as LiveDraft["maxClass"],
    targets: c.allowedTargets.slice(0, 1),
  };
}
