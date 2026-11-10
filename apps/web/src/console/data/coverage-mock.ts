import type { RiskClass } from "@/landing/lib/classifier-types";
import { ASSUME, type PricedClass } from "../../landing/lib/premium-model";
import {
  COVERAGE_ASSUME,
  DAY,
  NOW,
  heartbeatStale,
  type Attestor,
  type BuyInput,
  type CoveragePolicy,
  type CoverageQuote,
  type CoverageState,
  type CoverageStore,
  type PoolChecks,
} from "./coverage";

// SIMULATED. The book follows the prototype's seed: three policies for budi.testnet's agents, and other
// owners' policies so the concentration check has something to count. The pool contract owns the real checks.

const policy = (id: string, agent: string, target: string, limit: number, agoDays: number, paid: number): CoveragePolicy => {
  const startsAt = NOW - agoDays * DAY;
  return {
    id,
    agent,
    target,
    limit,
    payoutBps: COVERAGE_ASSUME.defaultPayoutBps,
    premiumPaid: paid,
    startsAt,
    expiresAt: startsAt + 30 * DAY,
    waitingEndsAt: startsAt + COVERAGE_ASSUME.waitingPeriodSec,
    status: "active",
  };
};

const OWN: CoveragePolicy[] = [
  policy("c-101", "rebalancer", "dex.testnet", 500, 8, 14.2),
  policy("c-102", "market-maker", "router.testnet", 2400, 6, 121),
  policy("c-103", "yield-runner", "vault.testnet", 200, 2, 3.1),
];

const OTHERS: CoveragePolicy[] = [
  policy("c-201", "desk-a.alpha.testnet", "router.testnet", 6200, 12, 311),
  policy("c-202", "desk-b.alpha.testnet", "router-2.testnet", 5400, 11, 270),
  policy("c-203", "run-3.cobalt.testnet", "router-2.testnet", 3800, 10, 190),
  policy("c-204", "run-4.cobalt.testnet", "dex.testnet", 7100, 15, 186),
  policy("c-205", "treasury.delta.testnet", "dex.testnet", 4800, 9, 126),
  policy("c-206", "treasury.delta.testnet", "vault.testnet", 9000, 9, 32),
  policy("c-207", "desk-c.alpha.testnet", "lend.testnet", 8000, 5, 211),
  policy("c-208", "run-5.cobalt.testnet", "vault.testnet", 6400, 4, 23),
];

/** Targets that share one implementation share a group, which is what the concentration check counts. */
const GROUP: Record<string, string> = {
  "vault.testnet": "vault-v1",
  "dex.testnet": "dex-v1",
  "router.testnet": "router-v1",
  "router-2.testnet": "router-v1",
  "lend.testnet": "lend-v1",
  "vault-budi.aruna.testnet": "vault-code-v1",
  "bridge.testnet": "bridge-v1",
};
export const groupOf = (target: string) => GROUP[target] ?? target;

/** Targets whose code another account can redeploy are watched by the second attestor. */
export const attestorFor = (target: string) => (target === "router.testnet" || target === "router-2.testnet" ? "attestor-2.testnet" : "attestor-1.testnet");

const ATTESTORS: Attestor[] = [
  { id: "attestor-1.testnet", heartbeatAgeBlocks: 120 },
  { id: "attestor-2.testnet", heartbeatAgeBlocks: 5400 },
];

const POOL_CAPITAL = 100_000;

const active = (book: CoveragePolicy[]) => book.filter((p) => p.status !== "expired" && NOW < p.expiresAt);
const totalLimits = (book: CoveragePolicy[]) => active(book).reduce((s, p) => s + p.limit, 0);

/** Premium = expected loss + capital cost + operations + risk margin, on the landing's assumption table. */
export function quoteCoverage(args: {
  cls: RiskClass | undefined;
  dailyCap: number;
  slippagePct: number;
  limit: number;
  days: number;
  payoutBps: number;
  utilization: number;
}): CoverageQuote {
  const maxExposure = args.dailyCap * args.days;
  const empty = { limit: 0, total: 0, pctOfLimit: 0, expectedLoss: 0, capitalCost: 0, opsCost: 0, riskMargin: 0, p: 0, maxExposure };
  if (!args.cls || args.cls === "unknown") {
    return { ...empty, priced: false, reason: "Mutability cannot be proved for this target, so it is not priced." };
  }
  const cls: Exclude<PricedClass, "unknown"> = args.cls;
  const limit = Math.min(args.limit, maxExposure);
  const p = ASSUME.pEvent30d[cls] * (args.days / 30);
  const expectedLoss = p * limit * (args.payoutBps / 10000) * (1 + ASSUME.slippageLoadPerPct * args.slippagePct);
  const capitalCost = limit * ASSUME.capitalCostAnnual * (args.days / 365) * ASSUME.capitalWeight[cls] * (1 + args.utilization * 0.5);
  const opsCost = (ASSUME.opsCostPerDay / 1_000_000) * args.days;
  const riskMargin = expectedLoss * ASSUME.riskMarginOfEL;
  const total = expectedLoss + capitalCost + opsCost + riskMargin;
  return { priced: true, limit, total, pctOfLimit: limit ? (total / limit) * 100 : 0, expectedLoss, capitalCost, opsCost, riskMargin, p, maxExposure };
}

export function createCoverageStore(): CoverageStore & {
  utilization(): number;
  checks(target: string, limit: number): PoolChecks;
  book(): CoveragePolicy[];
} {
  let own = [...OWN];
  const listeners = new Set<() => void>();
  const book = () => [...own, ...OTHERS];
  const state = (): CoverageState => ({ policies: own, attestors: ATTESTORS, poolCapital: POOL_CAPITAL });
  let snapshot = state();

  const checks = (target: string, limit: number): PoolChecks => {
    const max = POOL_CAPITAL * COVERAGE_ASSUME.capitalAdequacyK;
    const after = totalLimits(book()) + limit;
    const group = groupOf(target);
    const now = active(book())
      .filter((p) => groupOf(p.target) === group)
      .reduce((s, p) => s + p.limit, 0);
    const cap = POOL_CAPITAL * COVERAGE_ASSUME.concentrationPct;
    const adequacy = { ok: after <= max, after, max };
    const concentration = { ok: now + limit <= cap, after: now + limit, cap, group };
    return { ok: adequacy.ok && concentration.ok, adequacy, concentration };
  };

  return {
    get: () => snapshot,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    utilization: () => Math.min(1, totalLimits(book()) / (POOL_CAPITAL * COVERAGE_ASSUME.capitalAdequacyK)),
    checks,
    book,
    buy(input: BuyInput, quote: CoverageQuote) {
      if (!quote.priced) throw new Error("ARUNA_TARGET_NOT_COVERABLE: unknown targets cannot be covered.");
      const attestor = ATTESTORS.find((a) => a.id === attestorFor(input.target));
      if (attestor && heartbeatStale(attestor)) {
        throw new Error(`ARUNA_ATTESTOR_STALE: the attestor assigned to ${input.target} has stopped reporting, so coverage cannot be sold on it.`);
      }
      const c = checks(input.target, quote.limit);
      if (!c.adequacy.ok) throw new Error("ARUNA_POOL_CAPACITY: the pool is at its capital adequacy limit. Lower the limit or wait for capital.");
      if (!c.concentration.ok) throw new Error("ARUNA_CONCENTRATION_LIMIT: this implementation is at its concentration limit. Lower the limit or choose another target.");
      const id = `c-${300 + own.length + 1}`;
      const created: CoveragePolicy = {
        id,
        agent: input.agent,
        target: input.target,
        limit: quote.limit,
        payoutBps: input.payoutBps,
        premiumPaid: quote.total,
        startsAt: NOW,
        expiresAt: NOW + input.days * DAY,
        waitingEndsAt: NOW + COVERAGE_ASSUME.waitingPeriodSec,
        status: "waiting",
      };
      own = [...own, created];
      snapshot = state();
      listeners.forEach((l) => l());
      return created;
    },
  };
}

export const coverageStore = createCoverageStore();
