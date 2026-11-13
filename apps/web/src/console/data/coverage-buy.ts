import type { BuyRequest } from "@aruna/sdk/coverage";
import { BLOCKS_PER_DAY, PAYOUT_RATIO_BPS } from "./price";
import { nearToYocto } from "../fmt";

// The purchase form to the SDK's request, and the conditions the screen states before it lets a purchase be sent. The price
// is the pool's own `quote`; nothing here prices anything. The pool still decides, so a purchase it refuses comes back as an
// outcome with its reason; these checks only keep the screen from offering what is already known to fail.

export const DEFAULT_RATIO_PCT = PAYOUT_RATIO_BPS / 100;
export const DEFAULT_DAYS = 30;

export interface BuyForm {
  vault: string;
  agentPublicKey: string;
  target: string;
  /** The sum insured, in NEAR as typed. */
  limitNear: number;
  days: number;
  ratioPct: number;
}

export const windowBlocksOf = (days: number) => Math.round(days) * BLOCKS_PER_DAY;

/** A form that cannot be sent is a message, never a request with a zero in it. */
export function formProblem(f: BuyForm): string | null {
  if (!(f.limitNear > 0)) return "Enter a coverage limit above zero.";
  if (!Number.isInteger(f.days) || f.days < 1) return "Enter a whole number of days, at least 1.";
  if (!(f.ratioPct >= 1 && f.ratioPct <= 100)) return "The payout ratio is a percentage from 1 to 100.";
  return null;
}

export function buyRequestOf(f: BuyForm): BuyRequest {
  return {
    vault: f.vault,
    agentPublicKey: f.agentPublicKey,
    target: f.target,
    limit: nearToYocto(f.limitNear).toString(),
    payoutRatioBps: Math.round(f.ratioPct * 100),
    windowBlocks: windowBlocksOf(f.days),
  };
}

/** What the registry says about the attestor that watches a target. */
export interface Watch {
  attestor: string | null;
  fresh: boolean;
}

/** Why no purchase is offered, or null. A stale or missing heartbeat means drift on this target would go unreported (R30). */
export function watchProblem(target: string, w: Watch | null): string | null {
  if (w === null) return null;
  if (w.attestor === null) return `${target} has no attestor assigned, so a change to it would not be reported. Coverage cannot be sold on it.`;
  if (!w.fresh) return `The attestor assigned to ${target}, ${w.attestor}, has not sent a fresh heartbeat. Coverage cannot be sold while drift detection is unverified.`;
  return null;
}
