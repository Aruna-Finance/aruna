import type { Policy } from "@aruna/sdk/vault";

// Which agent actions a role may take, and why not (plan U6, R20, R21, AE1). The vault enforces all of this on
// chain; this file only tells the screen what to disable and what to say, so a refusal is explained before signing.

export type ActorRole = "owner" | "operator";
export type AgentAction = "pause" | "resume" | "revoke" | "tighten" | "loosen" | "set_operator" | "set_ceiling" | "withdraw";

export interface AgentState {
  status: "Active" | "Paused" | "Revoked";
  autoDisabled: boolean;
}

export type Availability = { enabled: true } | { enabled: false; reason: string };
const no = (reason: string): Availability => ({ enabled: false, reason });
const yes: Availability = { enabled: true };

const OWNER_ONLY: Partial<Record<AgentAction, string>> = {
  loosen: "only the owner can loosen a policy",
  set_operator: "only the owner can set or remove the operator",
  set_ceiling: "only the owner can change the ceiling",
  withdraw: "only the owner can withdraw",
};

export function availability(role: ActorRole, action: AgentAction, agent?: AgentState): Availability {
  if (role === "operator") {
    const why = OWNER_ONLY[action];
    if (why) return no(why);
  }
  if (action === "resume") {
    if (role === "operator") return no(agent?.autoDisabled ? "only the owner can resume an auto-disabled agent" : "only the owner can resume an agent");
    if (agent?.status === "Revoked") return no("this agent is revoked; its key is gone");
    if (agent && agent.status !== "Paused") return no("this agent is not paused");
    return yes;
  }
  if (action === "pause") {
    if (agent?.status === "Revoked") return no("this agent is revoked; its key is gone");
    if (agent?.status === "Paused") return no("this agent is already paused");
    return yes;
  }
  if (action === "revoke") {
    return agent?.status === "Revoked" ? no("this agent is already revoked") : yes;
  }
  if ((action === "tighten" || action === "loosen") && agent?.status === "Revoked") return no("this agent is revoked; its key is gone");
  return yes;
}

export const CLASS_RANK = { immutable_verified: 0, local_upgradeable: 1, global_by_account: 2, unknown: 3 } as const;

export interface CeilingLike {
  maxRiskClass: string;
  allowedTargets: string[];
  tokens?: { token: string; maxPerTx: string; dailyTotal: string }[];
  maxPerTx: string;
  dailyTotal: string;
}

export interface PolicyProblem {
  field: "limits" | "maxPerTx" | "dailyCap" | "allowedTargets" | "maxRiskClass" | "maxSlippageBps";
  message: string;
}

/** The first way a policy falls outside the ceiling, with the field named, or null. Checked before signing. */
export function policyProblem(p: Policy, c: CeilingLike): PolicyProblem | null {
  if (p.limits.length === 0) return { field: "limits", message: "Add a spending limit for at least one token." };
  if (!Number.isInteger(p.maxSlippageBps) || p.maxSlippageBps < 0 || p.maxSlippageBps > 10_000) return { field: "maxSlippageBps", message: "Slippage must be between 0 and 10000 basis points." };
  const caps = c.tokens ?? [{ token: "near", maxPerTx: c.maxPerTx, dailyTotal: c.dailyTotal }];
  for (const l of p.limits) {
    const cap = caps.find((x) => x.token === l.token);
    if (!cap) return { field: "limits", message: `The ceiling has no limit for ${l.token}, so an agent cannot spend it.` };
    if (BigInt(l.maxPerTx) <= 0n) return { field: "maxPerTx", message: `Per-transaction limit for ${l.token} must be above zero.` };
    if (BigInt(l.dailyCap) <= 0n) return { field: "dailyCap", message: `Daily limit for ${l.token} must be above zero.` };
    if (BigInt(l.maxPerTx) > BigInt(cap.maxPerTx)) return { field: "maxPerTx", message: `Per-transaction limit for ${l.token} is above the ceiling.` };
    if (BigInt(l.dailyCap) > BigInt(cap.dailyTotal)) return { field: "dailyCap", message: `Daily limit for ${l.token} is above the ceiling.` };
    if (BigInt(l.maxPerTx) > BigInt(l.dailyCap)) return { field: "maxPerTx", message: `Per-transaction limit for ${l.token} is above its daily limit.` };
  }
  if (p.allowedTargets.length === 0) return { field: "allowedTargets", message: "Allow at least one target." };
  const outside = p.allowedTargets.find((t) => !c.allowedTargets.includes(t));
  if (outside) return { field: "allowedTargets", message: `${outside} is not in the ceiling's allowed targets.` };
  const max = CLASS_RANK[c.maxRiskClass as keyof typeof CLASS_RANK];
  const mine = CLASS_RANK[p.maxRiskClass];
  if (max === undefined) return { field: "maxRiskClass", message: `The ceiling has an unknown risk class (${c.maxRiskClass}).` };
  if (mine > max) return { field: "maxRiskClass", message: `Risk class ${p.maxRiskClass} is above the ceiling's ${c.maxRiskClass}.` };
  return null;
}

/**
 * Whether `next` only tightens `prev` (an operator may; loosening is the owner's). A limit for a token the old
 * policy did not have, a higher limit, a new target, a higher class or more slippage all loosen.
 */
export function isTighter(prev: Policy, next: Policy): boolean {
  const limitsOk = next.limits.every((n) => {
    const o = prev.limits.find((l) => l.token === n.token);
    return o !== undefined && BigInt(n.maxPerTx) <= BigInt(o.maxPerTx) && BigInt(n.dailyCap) <= BigInt(o.dailyCap);
  });
  return limitsOk && next.maxSlippageBps <= prev.maxSlippageBps && CLASS_RANK[next.maxRiskClass] <= CLASS_RANK[prev.maxRiskClass] && next.allowedTargets.every((t) => prev.allowedTargets.includes(t));
}
