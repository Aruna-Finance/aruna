import type { AgentView, VaultView } from "@aruna/sdk";
import { yoctoToNear } from "../fmt";
import { keyInThisBrowser } from "../agent-keys";
import type { Attempt } from "./playground-scenarios";

// Checks before a run (plan U7, step 6). A failed check names its reason and a place to fix it, and the run does not
// start. They only read what the vault already reports; none of them classifies a target (CLAUDE.md rule 10).

export interface Check {
  id: "active" | "key" | "target" | "agentTarget" | "balance";
  label: string;
  ok: boolean;
  /** Why it failed. Empty when ok. */
  reason: string;
  fix?: { label: string; href: string };
}

/** The balance the vault should hold to pay gas for a run and settle the swaps it sends. */
export function neededBalance(attempts: Attempt[]): bigint {
  // Settling amounts are small; the "whole balance" attempt is refused, not paid. Gas for each call is paid by the vault.
  const swaps = attempts.filter((a) => a.id !== "i2").reduce((s, a) => s + BigInt(a.amount), 0n);
  const gas = BigInt(attempts.length) * 5n * 10n ** 21n;
  return swaps + gas;
}

export function preRunChecks(o: {
  vault: string;
  view: VaultView;
  agent: AgentView | null;
  held: readonly string[];
  swapTarget: string;
  balance: bigint | null;
  attempts: Attempt[];
}): Check[] {
  const { view, agent } = o;
  const agentsHref = `/console/agents/?vault=${encodeURIComponent(o.vault)}`;
  const active: Check = !agent
    ? { id: "active", label: "Agent is active", ok: false, reason: "No agent is chosen.", fix: { label: "Create an agent", href: `/console/agents/new/?vault=${encodeURIComponent(o.vault)}` } }
    : agent.status === "Active" && !agent.autoDisabled
      ? { id: "active", label: "Agent is active", ok: true, reason: "" }
      : {
          id: "active",
          label: "Agent is active",
          ok: false,
          reason: agent.autoDisabled ? "The vault stopped this agent after repeated refusals. Only the owner can resume it." : `This agent is ${agent.status}.`,
          fix: { label: "Open the agents", href: agentsHref },
        };
  const key: Check =
    agent && keyInThisBrowser(o.held, agent.publicKey)
      ? { id: "key", label: "Its key is in this browser", ok: true, reason: "" }
      : { id: "key", label: "Its key is in this browser", ok: false, reason: "This browser doesn't hold this agent's key, so it can't sign for it.", fix: { label: "Create an agent", href: `/console/agents/new/?vault=${encodeURIComponent(o.vault)}` } };
  const inCeiling = view.ceiling?.allowedTargets.includes(o.swapTarget) ?? false;
  const target: Check = inCeiling
    ? { id: "target", label: `${o.swapTarget} is in the vault limits`, ok: true, reason: "" }
    : { id: "target", label: `${o.swapTarget} is in the vault limits`, ok: false, reason: "The swap contract isn't in the vault limits, so the vault would refuse every swap.", fix: { label: "Edit vault limits", href: agentsHref } };
  // The agent's own list is what the vault checks first. If the swap is not on it, the in-policy swap is refused too,
  // and the injected run would be refused for the wrong reason.
  const onAgentList = agent?.policy.allowedTargets.includes(o.swapTarget) ?? false;
  const agentTarget: Check = onAgentList
    ? { id: "agentTarget", label: `${o.swapTarget} is on this agent's allowed contracts`, ok: true, reason: "" }
    : {
        id: "agentTarget",
        label: `${o.swapTarget} is on this agent's allowed targets`,
        ok: false,
        reason: "This agent isn't allowed to use the swap contract, so the vault would refuse every swap. The owner can add it to the agent's limits.",
        fix: agent ? { label: "Open the agent's policy", href: `/console/agents/detail?agent=${encodeURIComponent(agent.publicKey)}&vault=${encodeURIComponent(o.vault)}` } : { label: "Create an agent", href: `/console/agents/new/?vault=${encodeURIComponent(o.vault)}` },
      };
  const need = neededBalance(o.attempts);
  const balance: Check =
    o.balance !== null && o.balance >= need
      ? { id: "balance", label: "The vault can pay for the run", ok: true, reason: "" }
      : {
          id: "balance",
          label: "The vault can pay for the run",
          ok: false,
          reason: o.balance === null ? "Couldn't read the vault balance." : `The vault holds ${yoctoToNear(o.balance.toString())} NEAR; this run needs about ${yoctoToNear(need.toString())} NEAR.`,
          fix: { label: "Deposit", href: agentsHref },
        };
  return [active, key, target, agentTarget, balance];
}

export const allPass = (checks: Check[]) => checks.every((c) => c.ok);
