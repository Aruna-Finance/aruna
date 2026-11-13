import { isValidAccountId } from "@aruna/rpc";

// The question R26 asks of a vault: how much had this agent sent to this target, in this token, before this block. The answer
// is the vault's own `exposure_before` view; nothing here computes it. These helpers only turn the form into that call.

export interface ExposureForm {
  agent: string;
  target: string;
  /** "near", or the account of a NEP-141 token contract. */
  token: string;
  block: string;
}

export interface ExposureCall {
  args: { agent: string; target: string; token: "near" | { ft: string }; block: number };
}

/** A reason the form cannot be asked yet, or the call to make. A field that is wrong is named, never defaulted. */
export function exposureCall(f: ExposureForm): { problem: string } | ExposureCall {
  if (!f.agent) return { problem: "Choose an agent." };
  const target = f.target.trim();
  if (!isValidAccountId(target)) return { problem: "Enter the target as a NEAR account id, such as swap.arunafi.testnet." };
  const token = f.token.trim().toLowerCase() === "near" ? "near" : f.token.trim();
  if (token !== "near" && !isValidAccountId(token)) return { problem: 'Enter "near", or the account id of the token contract.' };
  if (!/^\d+$/.test(f.block.trim()) || Number(f.block) <= 0 || !Number.isSafeInteger(Number(f.block))) return { problem: "Enter a block height as a whole number above zero." };
  return { args: { agent: f.agent, target, token: token === "near" ? "near" : { ft: token }, block: Number(f.block) } };
}

/** The same question as a command anyone can run, so the page need not be trusted. */
export const exposureCommand = (vault: string, a: ExposureCall["args"]) => `node fixtures/tools.mjs view ${vault} exposure_before '${JSON.stringify(a)}'`;
