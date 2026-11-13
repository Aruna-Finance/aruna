import type { Reason } from "@aruna/sdk";

/**
 * What each vault refusal means, in a sentence a user can act on. Keyed by the SDK's own reason type, so a new
 * reason in the contract fails the type check here instead of reaching a user as a raw code.
 */
export const REASON_TEXT: Record<Reason, string> = {
  TARGET_NOT_ALLOWED: "This agent isn't allowed to use that contract.",
  MAX_PER_TX_EXCEEDED: "The amount is over this agent's per-transaction limit.",
  DAILY_CAP_EXCEEDED: "This would take the agent over its daily limit.",
  SLIPPAGE_TOO_HIGH: "The trade allows more slippage than this agent's limit.",
  RISK_CLASS_NOT_ALLOWED: "That contract is riskier than this agent may use.",
  TARGET_FROZEN: "That contract is frozen after a reported code change.",
  CLASS_STALE: "That contract's risk check is out of date and needs a refresh.",
  INSUFFICIENT_BALANCE: "The vault doesn't hold enough funds for this.",
  AGENT_NOT_ACTIVE: "This agent is paused or revoked.",
  AGENT_AUTO_DISABLED: "The vault stopped this agent after repeated refusals.",
};

/** The sentence for a reason code, with or without the ARUNA_ prefix; null for a code the SDK does not know. */
export function reasonText(code: string): string | null {
  const c = code.startsWith("ARUNA_") ? code.slice("ARUNA_".length) : code;
  return c in REASON_TEXT ? REASON_TEXT[c as Reason] : null;
}
