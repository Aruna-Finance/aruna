import type { VaultView } from "@aruna/sdk";
import { nearToYocto } from "../fmt";
import { riskiest, type TargetOption } from "./factory";

// Editing the owner's ceiling on a live vault (plan U6, R20). The result is the raw shape set_ceiling takes, the same
// one the factory accepts at creation. Tokens other than NEAR are carried over untouched, so editing the NEAR limits
// never silently drops a fungible-token limit. The riskiest class comes from the registry's classes of the chosen
// targets; the console never classifies a target itself (CLAUDE.md rule 10).

export type CurrentCeiling = NonNullable<VaultView["ceiling"]>;

export interface CeilingEdit {
  maxTx: number;
  daily: number;
  allowance: number;
  /** Every target the ceiling will allow, each with the class the registry holds for it. */
  targets: TargetOption[];
}

export function ceilingEditProblem(e: CeilingEdit): string | null {
  if (!(e.maxTx > 0)) return "Max per transaction must be above zero.";
  if (!(e.daily > 0)) return "Daily total must be above zero.";
  if (e.maxTx > e.daily) return "Max per transaction cannot exceed the daily total.";
  if (!(e.allowance > 0)) return "The gas allowance must be above zero.";
  if (e.targets.length === 0) return "Allow at least one target the registry has classified.";
  return null;
}

export function ceilingToRaw(current: CurrentCeiling, e: CeilingEdit) {
  const problem = ceilingEditProblem(e);
  if (problem) throw new Error(problem);
  const near = { token: "near" as const, max_per_tx: nearToYocto(e.maxTx).toString(), daily_total: nearToYocto(e.daily).toString() };
  const others = (current.tokens ?? []).filter((t) => t.token !== "near").map((t) => ({ token: { ft: t.token }, max_per_tx: t.maxPerTx, daily_total: t.dailyTotal }));
  return {
    tokens: [near, ...others],
    max_risk_class: riskiest(e.targets),
    allowed_targets: e.targets.map((t) => t.target),
    agent_allowance: nearToYocto(e.allowance).toString(),
  };
}
