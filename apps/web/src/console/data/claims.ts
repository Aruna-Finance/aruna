// Mock drift reports and claims. Shapes follow the prototype. The registry and pool contracts own the real
// state machine; the screens only read it. Every number is a mock.

export type ReportStatus = "challenge_window" | "disputed" | "paid" | "rejected";
export type ClaimStatus = ReportStatus;

export interface Report {
  id: string;
  target: string;
  attestor: string;
  channel: string;
  reportedAt: number;
  endsAt: number;
  observedAtBlock: number;
  changedAtBlock: number;
  /** The same moment as changedAtBlock, in seconds, so policies can be compared by time. */
  changedAtSec: number;
  beforeResolvedHash: string;
  afterResolvedHash: string;
  nonce: string;
  bond: number;
  status: ReportStatus;
  conflict?: { attestor: string; resolvedHash: string };
  ruling?: { uphold: boolean };
}

export interface Claim {
  id: string;
  report: string;
  policy: string;
  agent: string;
  target: string;
  /** Recorded exposure on the target before the changed block. */
  exposure: number;
  limit: number;
  payoutBps: number;
  status: ClaimStatus;
  payout: number;
  rejectReason?: string;
}

export interface Condition {
  id: "active" | "waiting" | "exposure" | "limit" | "challenge";
  label: string;
  ok: boolean;
}

export interface ClaimsState {
  now: number;
  arbiter: string;
  attestors: string[];
  subscribedVaults: number;
  reports: Report[];
  claims: Claim[];
}

export interface ClaimsStore {
  get(): ClaimsState;
  subscribe(l: () => void): () => void;
}

export const CLAIMS_ASSUME = { attestorBond: 500, maxLookbackBlocks: 7200, pollIntervalSec: 60 } as const;

export const statusLabel: Record<ReportStatus, string> = {
  challenge_window: "Challenge window",
  disputed: "Disputed",
  paid: "Paid",
  rejected: "Rejected",
};

/** payout = min(recorded_exposure x payout_ratio, remaining_limit) */
export const payoutOf = (c: Pick<Claim, "exposure" | "payoutBps" | "limit">) => Math.min((c.exposure * c.payoutBps) / 10_000, c.limit);
