// Refusal reasons: the contract's ARUNA_* values without the prefix (docs/CONTRACTS.md, "Canonical
// refusal reasons"). test/reasons.test.ts asserts this list and the auto-disable set against
// contracts/common/src/reasons.rs and the table in docs/CONTRACTS.md; let them drift and every
// integrator's error handling rots (docs/SDK.md).

export const REASONS = [
  "TARGET_NOT_ALLOWED",
  "MAX_PER_TX_EXCEEDED",
  "DAILY_CAP_EXCEEDED",
  "SLIPPAGE_TOO_HIGH",
  "RISK_CLASS_NOT_ALLOWED",
  "TARGET_FROZEN",
  "CLASS_STALE",
  "INSUFFICIENT_BALANCE",
  "AGENT_NOT_ACTIVE",
  "AGENT_AUTO_DISABLED",
] as const;

export type Reason = (typeof REASONS)[number];

/** Agent-caused refusals: only these count toward auto-disable (docs/DECISIONS.md D-19). */
export const AUTO_DISABLE_REASONS: readonly Reason[] = ["TARGET_NOT_ALLOWED", "MAX_PER_TX_EXCEEDED", "DAILY_CAP_EXCEEDED", "SLIPPAGE_TOO_HIGH"];

/** Maps a contract value such as `ARUNA_CLASS_STALE` to its SDK code. Throws on a value the SDK does
 * not know, loudly, rather than passing an unknown refusal through as if it were understood. */
export function parseReason(contractValue: string): Reason {
  const code = contractValue.startsWith("ARUNA_") ? contractValue.slice("ARUNA_".length) : "";
  if (!(REASONS as readonly string[]).includes(code)) throw new Error(`unknown refusal reason from the contract: ${contractValue}`);
  return code as Reason;
}
