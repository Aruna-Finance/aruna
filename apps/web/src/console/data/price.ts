import type { QuoteResult } from "@aruna/sdk/coverage";
import { yoctoToNear } from "../fmt";

// Declared inputs of the price panel (plan U8, R27). The premium itself is never computed here: it comes from the pool's
// own `quote` view through the SDK. These are only the assumptions the quote needs besides the daily cap, and they are
// shown to the user as assumptions.

/** The testnet contracts the factory deploys against. The pool reads classes from this registry. */
export const REGISTRY = "registry2.arunafi.testnet";
export const POOL = "pool2.arunafi.testnet";

export const PAYOUT_RATIO_BPS = 8000;
/** The pool's own assumption (`quote.assumptions.blocks_per_day`); the window below is only a length in blocks. */
export const BLOCKS_PER_DAY = 43_200;
export const WINDOW_DAYS = 30;
export const WINDOW_BLOCKS = WINDOW_DAYS * BLOCKS_PER_DAY;

/**
 * The sum insured offered by default: more than the daily cap times the days the quote counts, so the payout the pool
 * can reach is bound by the cap and the premium follows the cap. A limit below that bound would hold the premium flat
 * when the cap changes. Two days are added because the pool counts the days of the window with rounding up.
 */
export function defaultLimit(dailyCapYocto: bigint): string {
  return (dailyCapYocto * BigInt(WINDOW_DAYS + 2)).toString();
}

/** What a refusal from the SDK means to the owner, in words. The SDK's own detail is kept for the tooltip. */
const REFUSAL_TEXT: Record<string, string> = {
  no_class_record: "Not priced: this target has no class on record.",
  not_coverable: "Not priced: this target cannot be covered.",
  agent_not_found: "Not priced: the vault does not know this agent.",
  no_daily_cap: "Not priced: a daily cap of zero leaves the exposure unbounded.",
  class_not_insurable: "Not priced: the pool does not insure this class.",
  class_above_proposed: "Not allowed: this draft's class ceiling excludes the target.",
};

export type Cell = { kind: "price"; premium: string; reachable: string; cls: string } | { kind: "refused"; text: string; detail: string };

/** One quote as a table cell: the pool's premium in NEAR, or the reason there is none. Never a zero standing in for a refusal. */
export function describeQuote(r: QuoteResult): Cell {
  if (!r.ok) return { kind: "refused", text: REFUSAL_TEXT[r.reason] ?? "Not priced.", detail: r.detail };
  return { kind: "price", premium: yoctoToNear(r.quote.premium), reachable: yoctoToNear(r.quote.reachable_payout), cls: r.inputs.class };
}
