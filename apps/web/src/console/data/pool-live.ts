import type { Book, Coverage } from "@aruna/sdk/coverage";
import { tokenOf } from "./coverage-live";

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

export const tokensOf = (list: readonly Coverage[]): string[] => ["near", ...new Set(list.map((c) => tokenOf(c.token)).filter((t) => t !== "near"))];

/** Whole percent of a basis-point figure, one decimal. */
export const bpsText = (bps: number) => `${(bps / 100).toFixed(1)}%`;
