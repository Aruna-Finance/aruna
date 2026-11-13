import type { Coverage } from "@aruna/sdk/coverage";
import { yoctoToNear } from "../fmt";
import { formatUnits, type TokenMeta } from "./token-amount";

// Coverage as the pool reports it, for the list on /console/coverage. Block heights, not dates: the pool counts in blocks
// and a block time is not a promise. Nothing here prices anything or decides a claim; it names where a coverage is.

export type LiveStage = "waiting" | "active" | "claim_in_flight" | "paid" | "ended" | "released";

export interface CoverageRow {
  id: number;
  vault: string;
  agent: string;
  target: string;
  /** "near", or the token contract's account id. */
  token: string;
  limit: string;
  payoutRatioBps: number;
  premiumPaid: string;
  paidOut: string;
  startBlock: number;
  waitingEndsBlock: number;
  endBlock: number;
  stage: LiveStage;
}

export const STAGE_TEXT: Record<LiveStage, string> = {
  waiting: "Waiting period",
  active: "Active",
  claim_in_flight: "Claim in progress",
  paid: "Paid",
  ended: "Ended",
  released: "Released",
};

export function tokenOf(t: Coverage["token"]): string {
  return t === "near" ? "near" : t.ft;
}

/** The stage at a head block. A payout recorded on the coverage wins over its calendar, because it is what happened. */
export function stageOf(c: Coverage, head: number): LiveStage {
  if (c.released) return "released";
  if (c.claim_in_flight) return "claim_in_flight";
  if (BigInt(c.paid_out) > 0n) return "paid";
  if (head >= c.end_block) return "ended";
  return head < c.waiting_period_ends ? "waiting" : "active";
}

export function coverageRows(list: readonly Coverage[], head: number): CoverageRow[] {
  return list.map((c) => ({
    id: c.id,
    vault: c.vault,
    agent: c.agent,
    target: c.target,
    token: tokenOf(c.token),
    limit: c.limit,
    payoutRatioBps: c.payout_ratio_bps,
    premiumPaid: c.premium_paid,
    paidOut: c.paid_out,
    startBlock: c.start_block,
    waitingEndsBlock: c.waiting_period_ends,
    endBlock: c.end_block,
    stage: stageOf(c, head),
  }));
}

/** NEAR in whole units; a fungible token in its own units once its metadata is read, and in its smallest unit, named, until then. */
export function amountText(token: string, amount: string, meta?: TokenMeta | null): string {
  if (token === "near") return `${yoctoToNear(amount)} NEAR`;
  return meta ? `${formatUnits(amount, meta.decimals)} ${meta.symbol}` : `${amount} (smallest unit of ${token})`;
}

/** Blocks left to a height, for a screen to say "in 1,234 blocks". Negative means it has passed. */
export const blocksTo = (height: number, head: number) => height - head;
