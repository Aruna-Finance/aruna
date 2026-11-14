import type { Book, Coverage } from "@aruna/sdk/coverage";
import { tokenOf } from "./coverage-live";
import { USDC } from "./price";
import { parseUnits } from "./token-amount";

// The pool as the contract reports it, for /console/pool. Nothing here decides anything: the rules below are the contract's
// own, copied from contracts/common/src/params.rs and pinned to it by a test.

export const K_X100 = 500n;
export const CONCENTRATION_BPS = 20_000n;

export interface BookFigures {
  token: string;
  capital: bigint;
  totalShares: bigint;
  totalLimits: bigint;
  /** The most limits the contract accepts: k x capital. */
  maxLimits: bigint;
  /** Room left under k x capital. Zero when full. */
  headroom: bigint;
  /** What one group may hold: the concentration limit x capital. */
  groupCap: bigint;
  lockedUntil: number;
  locked: boolean;
  blocksToUnlock: number;
}

export function bookFigures(token: string, b: Book, head: number): BookFigures {
  const capital = BigInt(b.capital);
  const totalLimits = BigInt(b.total_limits);
  const maxLimits = (K_X100 * capital) / 100n;
  return {
    token,
    capital,
    totalShares: BigInt(b.total_shares),
    totalLimits,
    maxLimits,
    headroom: maxLimits > totalLimits ? maxLimits - totalLimits : 0n,
    groupCap: (CONCENTRATION_BPS * capital) / 10_000n,
    lockedUntil: b.locked_until,
    locked: head < b.locked_until,
    blocksToUnlock: Math.max(0, b.locked_until - head),
  };
}

export type GroupBy = "code_hash" | "upgrade_authority";

export interface GroupRow {
  key: string;
  /** Limits still on the book for this group: not released, less what was paid. */
  limit: bigint;
  /** limit / the group cap, in basis points. Over 10000 means over the cap. */
  usedBps: number;
  coverages: number;
  targets: string[];
}

/** Coverage by group for one token. A released coverage has left the contract's totals, so it leaves here too. */
export function groupRows(list: readonly Coverage[], by: GroupBy, token: string, groupCap: bigint): GroupRow[] {
  const map = new Map<string, { limit: bigint; n: number; targets: Set<string> }>();
  for (const c of list) {
    if (c.released || tokenOf(c.token) !== token) continue;
    const remaining = BigInt(c.limit) - BigInt(c.paid_out);
    const key = by === "code_hash" ? c.code_hash : c.upgrade_authority;
    const g = map.get(key) ?? { limit: 0n, n: 0, targets: new Set<string>() };
    g.limit += remaining > 0n ? remaining : 0n;
    g.n += 1;
    g.targets.add(c.target);
    map.set(key, g);
  }
  return [...map.entries()]
    .map(([key, g]) => ({
      key,
      limit: g.limit,
      usedBps: groupCap > 0n ? Number((g.limit * 10_000n) / groupCap) : g.limit > 0n ? Number.MAX_SAFE_INTEGER : 0,
      coverages: g.n,
      targets: [...g.targets].sort(),
    }))
    .sort((a, b) => (a.limit === b.limit ? a.key.localeCompare(b.key) : a.limit > b.limit ? -1 : 1));
}

export interface StageCounts {
  /** Before its end block, no payout, no claim running. */
  active: number;
  /** Past its end block, still on the book until someone calls release_expired. */
  ended: number;
  claimInFlight: number;
  paid: number;
  released: number;
}

export function stageCounts(list: readonly Coverage[], token: string, head: number): StageCounts {
  const out: StageCounts = { active: 0, ended: 0, claimInFlight: 0, paid: 0, released: 0 };
  for (const c of list) {
    if (tokenOf(c.token) !== token) continue;
    if (c.released) out.released += 1;
    else if (c.claim_in_flight) out.claimInFlight += 1;
    else if (BigInt(c.paid_out) > 0n) out.paid += 1;
    else if (head >= c.end_block) out.ended += 1;
    else out.active += 1;
  }
  return out;
}

/**
 * The books the screen lists: NEAR and the test USDC, always. The pool opens a book for any token contract that calls its
 * `ft_on_transfer`, so a token that merely appears in a coverage is not a book this console presents or deposits into.
 */
export const BOOK_TOKENS: readonly string[] = ["near", USDC];

/** Whole percent of a basis-point figure, one decimal. */
export const bpsText = (bps: number) => `${(bps / 100).toFixed(1)}%`;

// ---- Underwriter actions. The pool's own share rules (contracts/pool/src/lib.rs `deposit_for` and `withdraw`), copied so the
// dialog can show an estimate. The contract decides; the figures here are labelled estimates at the block they were read. ----

/** What the connected account holds of one token, read when the screen loads. Absent while the read has not answered. */
export type WalletToken = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; balance: bigint; registered: boolean };

/** Shares minted for a deposit: 1:1 into an empty book, else at the book's capital per share, rounded down. */
export const mintedShares = (amount: bigint, capital: bigint, totalShares: bigint): bigint =>
  totalShares === 0n || capital === 0n ? amount : (amount * totalShares) / capital;

/** The tokens a number of shares is worth, rounded down. */
export const payoutFor = (shares: bigint, capital: bigint, totalShares: bigint): bigint => (totalShares === 0n ? 0n : (shares * capital) / totalShares);

/** The shares a token amount converts to, rounded down, so the payout never exceeds the amount asked for. */
const sharesForAmount = (amount: bigint, capital: bigint, totalShares: bigint): bigint => (capital === 0n ? 0n : (amount * totalShares) / capital);

const shareBps = (shares: bigint, totalShares: bigint): number => (totalShares === 0n ? 0 : Number((shares * 10_000n) / totalShares));

const plural = (n: number) => `${n.toLocaleString("en-US")} more ${n === 1 ? "block" : "blocks"}`;

/**
 * Why a deposit cannot be offered, or null when it can. A book with no capital left but shares outstanding would mint the
 * depositor 1:1 while the old shares still exist, so the earlier holders would take a part of the deposit.
 */
export function depositBlock(f: BookFigures, token: string, symbol: string, wallet: WalletToken | undefined): string | null {
  if (!wallet || wallet.state === "loading") return "Checking your balance.";
  if (wallet.state === "error") return "Could not read your balance. Reload the page to try again.";
  if (f.capital === 0n && f.totalShares > 0n) {
    return "Deposits are paused: this book has no capital left but still has shares outstanding, so a new deposit would be shared with the earlier holders.";
  }
  if (token !== "near" && wallet.balance === 0n) return `You hold no ${symbol}. It isn't publicly mintable, so only a wallet it was sent to can deposit here.`;
  return null;
}

/**
 * Why a withdrawal cannot be offered, or null when it can. A token payout is a transfer the pool does not wait for: to an
 * account not registered on the token it fails and the amount is lost, so that is refused before anything is signed.
 */
export function withdrawBlock(f: BookFigures, held: bigint, token: string, symbol: string, wallet: WalletToken | undefined): string | null {
  if (held === 0n) return "You have no position in this book.";
  if (f.locked) return `The book is locked for ${plural(f.blocksToUnlock)}.`;
  if (token !== "near") {
    if (!wallet || wallet.state === "loading") return `Checking your registration on ${symbol}.`;
    if (wallet.state === "error") return `Could not check your registration on ${symbol}. Reload the page to try again.`;
    if (!wallet.registered) return `Your account isn't registered on the ${symbol} contract, so a payout would be lost. Register it first.`;
  }
  return null;
}

export type DepositCheck = { ok: true; amount: bigint; shares: bigint; shareBps: number } | { ok: false; reason: string };

/** A typed deposit against the book: the amount in the token's smallest unit, the shares it should buy and what share of the book they make. */
export function checkDeposit(text: string, decimals: number, f: BookFigures, balance: bigint, fmt: (v: bigint) => string): DepositCheck {
  const amount = parseUnits(text, decimals);
  if (amount === null || amount === 0n) return { ok: false, reason: "Enter an amount, for example 1.5." };
  if (amount > balance) return { ok: false, reason: `That is more than the ${fmt(balance)} in your wallet.` };
  const shares = mintedShares(amount, f.capital, f.totalShares);
  if (shares === 0n) return { ok: false, reason: "Too small: it would buy no share of the book, and the pool would return it." };
  return { ok: true, amount, shares, shareBps: shareBps(shares, f.totalShares + shares) };
}

export type WithdrawCheck = { ok: true; shares: bigint; receives: bigint } | { ok: false; reason: string };

/** A withdrawal of everything the holder owns, or of a typed token amount converted to shares rounded down. */
export function checkWithdraw(input: { all: true } | { text: string }, decimals: number, f: BookFigures, held: bigint, fmt: (v: bigint) => string): WithdrawCheck {
  if (held === 0n) return { ok: false, reason: "You have no position in this book." };
  if ("all" in input) return { ok: true, shares: held, receives: payoutFor(held, f.capital, f.totalShares) };
  const amount = parseUnits(input.text, decimals);
  if (amount === null || amount === 0n) return { ok: false, reason: "Enter an amount, for example 1.5." };
  const shares = sharesForAmount(amount, f.capital, f.totalShares);
  if (shares === 0n) return { ok: false, reason: "Too small: it is worth less than one share of the book." };
  if (shares > held) return { ok: false, reason: `That is more than your position, worth ${fmt(payoutFor(held, f.capital, f.totalShares))}.` };
  return { ok: true, shares, receives: payoutFor(shares, f.capital, f.totalShares) };
}
