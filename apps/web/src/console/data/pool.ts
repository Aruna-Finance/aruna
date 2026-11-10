import type { RiskClass } from "@/landing/lib/classifier-types";
import { COVERAGE_ASSUME, stageOf, type CoveragePolicy } from "./coverage";

// Mock pool. The pool contract owns the real numbers; these helpers only group and add what the book holds.

export interface Deposit {
  id: string;
  account: string;
  amount: number;
  classes: Exclude<RiskClass, "unknown">[];
}

export type GroupBy = "code_hash" | "global_contract";

export interface ConcGroup {
  key: string;
  limit: number;
  policies: number;
  targets: string[];
  /** The most this group may carry: a share of pool capital. */
  cap: number;
  /** The group's limit as a share of pool capital. */
  share: number;
  over: boolean;
}

const live = (p: CoveragePolicy) => stageOf(p) !== "CoverageExpired";

/** Coverage limit per group of targets that fail together. Targets with no key in this grouping are left out. */
export function concentration(book: CoveragePolicy[], keyOf: (target: string) => string | undefined, capital: number): ConcGroup[] {
  const groups = new Map<string, { limit: number; policies: number; targets: Set<string> }>();
  for (const p of book.filter(live)) {
    const key = keyOf(p.target);
    if (!key) continue;
    const g = groups.get(key) ?? { limit: 0, policies: 0, targets: new Set<string>() };
    g.limit += p.limit;
    g.policies += 1;
    g.targets.add(p.target);
    groups.set(key, g);
  }
  const cap = capital * COVERAGE_ASSUME.concentrationPct;
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      limit: g.limit,
      policies: g.policies,
      targets: [...g.targets],
      cap,
      share: capital ? g.limit / capital : 0,
      over: g.limit > cap,
    }))
    .sort((a, b) => b.limit - a.limit);
}

/** Capital that can leave: what is not needed to back live coverage, and nothing while a challenge window is open. */
export function withdrawable(capital: number, totalLimits: number, pending: boolean) {
  const required = Math.ceil(totalLimits / COVERAGE_ASSUME.capitalAdequacyK);
  const free = pending ? 0 : Math.max(0, capital - required);
  return { free, required, pending };
}

/** Most the largest group could pay if every limit in it is fully exposed. */
export const worstCasePayout = (topLimit: number) => Math.round((topLimit * COVERAGE_ASSUME.defaultPayoutBps) / 10_000);
