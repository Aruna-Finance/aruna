import { block } from "../fmt";
import { bpsText, type BookFigures, type DepositCheck } from "./pool-live";

// What the confirmation dialog says before an underwriter signs. Pure text from the book's figures. The figures are estimates at
// the block they were read: premiums, claims and other deposits move the book until the transaction lands, and the contract
// takes no minimum, so the dialog says so rather than promise a number. A share count is never shown, only the token
// amounts and percentages the Pool screen already uses.

const blocks = (n: number) => `${n.toLocaleString("en-US")} more ${n === 1 ? "block" : "blocks"}`;

/** The lock, before signing, with the rule that makes it open-ended: any coverage bought on the book moves it for everyone. */
export function lockText(f: BookFigures): string {
  if (f.locked) {
    return `This book is locked until block ${block(f.lockedUntil)}, ${blocks(f.blocksToUnlock)} from now. Any new coverage on this book can push that later, for every underwriter.`;
  }
  return "This book is open for withdrawal now. Any new coverage on this book locks all of its capital until that coverage ends and its claim period has passed, for every underwriter.";
}

/** The book's capital per share to four places: a ratio, never a count. An empty book mints 1:1. */
export function sharePriceText(f: BookFigures): string {
  if (f.totalShares === 0n || f.capital === 0n) return "1.0000 (the first deposit into an empty book buys shares 1:1)";
  const r = (f.capital * 10_000n) / f.totalShares;
  return `${r / 10_000n}.${(r % 10_000n).toString().padStart(4, "0")}`;
}

export function depositReview(i: { label: string; amountText: string; check: Extract<DepositCheck, { ok: true }>; f: BookFigures; head: number }): { actions: string[]; note: string } {
  return {
    actions: [
      `Deposit ${i.amountText} into the ${i.label} book`,
      `Estimated share: about ${bpsText(i.check.shareBps)} of the book, at a share price of ${sharePriceText(i.f)} (read at block ${block(i.head)}; the pool decides at signing)`,
    ],
    note: lockText(i.f),
  };
}

export function withdrawReview(i: { label: string; receivesText: string; all: boolean; f: BookFigures; head: number }): { actions: string[]; note: string } {
  return {
    actions: [
      i.all ? `Withdraw everything you hold in the ${i.label} book` : `Withdraw from the ${i.label} book`,
      `You receive about ${i.receivesText} (estimate at block ${block(i.head)}; premiums and claims change the book's capital until the transaction lands)`,
    ],
    note: "The pool refuses a withdrawal while the book is locked or if you hold fewer shares than this. A refusal moves nothing.",
  };
}

/**
 * The shares a withdrawal sends. Everything is read again just before signing, so it sends what the holder owns then and
 * not what the page showed when it loaded; a typed amount sends the shares worked out at review.
 */
export async function sharesToWithdraw(plan: { all: true } | { shares: bigint }, readHeld: () => Promise<bigint>): Promise<string> {
  return ("all" in plan ? await readHeld() : plan.shares).toString();
}
