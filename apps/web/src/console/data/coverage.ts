import type { RiskClass } from "@/landing/lib/classifier-types";

// Mock coverage book and pool snapshot. Shapes follow the prototype. Every constant below is an underwriting
// assumption owned by the contract team (docs/UI-PLAN.md), not a measurement, and the screens say so.

export const DAY = 86_400;
/** The prototype's demo clock: 2026-11-01 00:00 UTC. */
export const NOW = 1_793_491_200;

export const COVERAGE_ASSUME = {
  waitingPeriodSec: 3 * DAY,
  challengeWindowSec: 2 * DAY,
  capitalAdequacyK: 3,
  concentrationPct: 0.2,
  heartbeatMaxAgeBlocks: 1800,
  defaultPayoutBps: 8000,
} as const;

export type CoverageStatus = "waiting" | "active" | "expired";
export type CoverageStage = "WaitingPeriod" | "CoverageActive" | "ChallengeWindow" | "PayoutExecuted" | "CoverageExpired";

export interface CoveragePolicy {
  id: string;
  agent: string;
  target: string;
  limit: number;
  payoutBps: number;
  premiumPaid: number;
  startsAt: number;
  expiresAt: number;
  waitingEndsAt: number;
  status: CoverageStatus;
}

export interface Attestor {
  id: string;
  /** Blocks since it last signed a heartbeat. */
  heartbeatAgeBlocks: number;
}

export interface BuyInput {
  agent: string;
  target: string;
  limit: number;
  days: number;
  payoutBps: number;
}

export interface CoverageQuote {
  priced: boolean;
  reason?: string;
  limit: number;
  total: number;
  pctOfLimit: number;
  expectedLoss: number;
  capitalCost: number;
  opsCost: number;
  riskMargin: number;
  p: number;
  /** The most the agent's policy can send in the period. */
  maxExposure: number;
}

export interface PoolChecks {
  ok: boolean;
  adequacy: { ok: boolean; after: number; max: number };
  concentration: { ok: boolean; after: number; cap: number; group: string };
}

export interface CoverageState {
  /** This owner's policies. */
  policies: CoveragePolicy[];
  attestors: Attestor[];
  poolCapital: number;
}

export interface CoverageStore {
  get(): CoverageState;
  subscribe(l: () => void): () => void;
  buy(input: BuyInput, quote: CoverageQuote): CoveragePolicy;
}

export const stageOf = (p: CoveragePolicy, now = NOW): CoverageStage => {
  if (p.status === "expired" || now >= p.expiresAt) return "CoverageExpired";
  return now < p.waitingEndsAt ? "WaitingPeriod" : "CoverageActive";
};

export const heartbeatStale = (a: Attestor) => a.heartbeatAgeBlocks > COVERAGE_ASSUME.heartbeatMaxAgeBlocks;

export type { RiskClass };
