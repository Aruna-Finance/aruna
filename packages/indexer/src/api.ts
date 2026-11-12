// The indexer's read contract (plan U1, R7, R8, KTD4). Both the server and every client build against
// these types and nothing else. GET only, JSON, open CORS, no auth. Every response says how far the
// indexer has read, so a caller can tell "nothing happened" from "not indexed yet".

/** Default and maximum page sizes. The server clamps `limit` to MAX_LIMIT. */
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

/** `near`, or the NEP-141 contract account id of a fungible token. */
export type TokenKey = string;

/** Every list route returns a page. `next_after` is the `after` cursor for the following page, or
 * null on the last one. Items are ordered by `seq`, the order the indexer read them from the chain. */
export interface Page<T> {
  last_indexed_block: number;
  items: T[];
  next_after: number | null;
}

export interface Health {
  last_indexed_block: number;
  /** The chain's final block when last checked; null before the first check. */
  head_block: number | null;
  lag_blocks: number | null;
  /** How long ago the indexer last read the chain's head; null before the first read. Healthy needs a recent read
   * as well as a small lag, so an indexer that stopped reading is never reported as caught up. */
  head_seen_ms_ago: number | null;
  /** Events kept raw because their name or shape was not recognised (R4). */
  unparsed_events: number;
  healthy: boolean;
  /** The block source serving blocks now, by label (never its URL). Absent before the first block. */
  source?: string;
  /** `catching_up` while the lag exceeds the healthy limit, `following` within it. Absent before the first head. */
  mode?: "catching_up" | "following";
}

/** Where an item came from on chain. */
export interface ChainRef {
  /** Monotonic position in the indexer's read order. Also the pagination cursor. */
  seq: number;
  block: number;
  timestamp_ms: number;
  tx_hash: string;
  receipt_id: string;
}

export interface VaultSummary {
  vault: string;
  factory: string;
  /** Current owner and operator, from creation and any later `owner_changed` / `operator_changed`. */
  owner: string;
  operator: string | null;
  code_hash: string;
  created_block: number;
  created_tx: string;
}

export const ACTIVITY_KINDS = [
  "allowed",
  "refused",
  "failed",
  "exposure",
  "auto_disabled",
  "agent_registered",
  "status_changed",
  "policy_updated",
  "class_refreshed",
  "target_frozen",
  "deposit",
  "withdrawal",
  "ceiling_updated",
  "operator_changed",
  "owner_changed",
  "other",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** One vault event, normalised for display. `data` is the event's own payload, unchanged. */
export interface ActivityItem extends ChainRef {
  kind: ActivityKind;
  event: string;
  vault: string;
  agent: string | null;
  target: string | null;
  /** In the token's smallest unit, as a decimal string. */
  amount: string | null;
  token: TokenKey | null;
  /** `ARUNA_*` reason code on a refusal. */
  reason: string | null;
  /** The target's class at the time of the event, or null when the vault had none cached. */
  class: string | null;
  data: Record<string, unknown>;
}

/** One `exposure_recorded`: what was sent, not the value of a position (R3, R25). */
export interface ExposureRow extends ChainRef {
  vault: string;
  agent: string;
  target: string;
  token: TokenKey;
  amount: string;
  /** Running total for this vault, target and token after this row. */
  total: string;
  /** The target's class when the exposure was recorded. */
  class: string | null;
}

/** Any aruna event from a watched contract: registries, factories, pools and vaults. */
export interface EventItem extends ChainRef {
  contract: string;
  event: string;
  data: Record<string, unknown>;
}

export interface PageQuery {
  /** Return items with `seq` greater than this. */
  after?: number;
  limit?: number;
}

export interface VaultsQuery extends PageQuery {
  owner?: string;
  operator?: string;
  code_hash?: string;
}

export interface ActivityQuery extends PageQuery {
  agent?: string;
  kind?: ActivityKind;
}

export interface ExposureQuery extends PageQuery {
  agent?: string;
  target?: string;
  token?: TokenKey;
}

/** Coverage, claims, drift reports, freezes, heartbeats and class changes are all events; these
 * filters select them (R7). `vault`, `target`, `attestor` and `coverage` match fields the indexer
 * extracts from each event's payload. */
export interface EventsQuery extends PageQuery {
  contract?: string;
  /** One event name, or several separated by commas. */
  event?: string;
  vault?: string;
  target?: string;
  attestor?: string;
  coverage?: number;
}

// ---- coverage, claims and drift (R7) ------------------------------------------------------------
//
// These routes serve STATE derived from the contracts' events, in the order the indexer read them. A few
// fields depend on the chain's clock (a coverage's status, a pending report that has become verified, an
// attestor being alive); they are computed against `last_indexed_block`, which every page reports, so they
// are as of that block and never ahead of it.

/** `contracts/common/src/params.rs`: a Pending report reads as Verified once this many blocks have passed. A test fails if they differ. */
export const CHALLENGE_WINDOW_BLOCKS = 300;
/** `contracts/common/src/params.rs`: an attestor whose last heartbeat is older than this is not alive. A test fails if they differ. */
export const HEARTBEAT_STALE_BLOCKS = 600;

/** `waiting`: before the waiting period ends. `active`: a change can pay. `expired`: past `end_block`, claims still possible. `released`: its remaining limit has left the book. */
export type CoverageStatus = "waiting" | "active" | "expired" | "released";

/** A coverage, from `coverage_purchased`, with what later claims did to it. The chain ref is the purchase's. */
export interface CoverageItem extends ChainRef {
  /** The pool contract that sold it. Coverage ids are per pool. */
  pool: string;
  id: number;
  /** The vault's owner at purchase: payouts go here. */
  owner: string;
  vault: string;
  agent: string;
  target: string;
  token: TokenKey;
  /** The sum insured C, in the token's smallest unit. */
  limit: string;
  payout_ratio_bps: number;
  premium_paid: string;
  class: string;
  code_hash: string;
  upgrade_authority: string;
  start_block: number;
  waiting_period_ends: number;
  end_block: number;
  /** The policy version it was priced on. */
  policy_version: number;
  daily_cap_priced: string;
  /** Total paid out so far, from `claim_paid` events. */
  paid_out: string;
  claims_paid: number;
  claims_rejected: number;
  released: boolean;
  status: CoverageStatus;
}

/** One claim attempt: `claim_paid` or `claim_rejected`. A paid one carries every term of the payout. */
export interface ClaimItem extends ChainRef {
  pool: string;
  coverage: number;
  report: number;
  outcome: "paid" | "rejected";
  /** Why a rejected claim was refused, in the pool's own words. */
  reason: string | null;
  /** What was paid. */
  payout: string | null;
  /** Exposure recorded after the last paid change and before this one: what the payout is computed from. */
  exposure_in_window: string | null;
  exposure_before_change: string | null;
  exposure_through_last_paid_block: string | null;
  payout_ratio_bps: number | null;
  /** The sum insured C. */
  limit: string | null;
  /** Paid out on this coverage before this claim: the remaining limit is `limit - paid_before`. */
  paid_before: string | null;
  to: string | null;
  token: TokenKey | null;
  /** From the coverage, when the indexer saw its purchase. */
  vault: string | null;
  target: string | null;
  owner: string | null;
}

/** `pending` becomes `verified` on its own when the challenge window passes, so that is applied here too. */
export type ReportState = "pending" | "disputed" | "verified" | "rejected";

/** A signed drift report, from `drift_reported`, with its state after any dispute and ruling. */
export interface ReportItem extends ChainRef {
  registry: string;
  id: number;
  target: string;
  attestor: string;
  observed_at_block: number;
  /** The attestor's claim of the first block running the new code. Not verifiable on chain. */
  changed_at_block: number;
  before_ref: unknown;
  after_ref: unknown;
  before_resolved_hash: string;
  after_resolved_hash: string;
  channel: string;
  nonce: number;
  expires_at: number;
  reported_at_block: number;
  /** The report that disputes this one, or that this one disputes. */
  disputed_by: number | null;
  /** As of `last_indexed_block`. */
  state: ReportState;
  /** `reported_at_block` plus the challenge window. */
  challenge_window_ends: number;
}

/** A registry freeze event. The last one for a target says whether it is frozen: see `frozen_after`. */
export interface FreezeItem extends ChainRef {
  registry: string;
  target: string;
  /** `frozen`: a report was accepted. `pushed`: the freeze was sent to a batch of vaults. `lifted`: the owner lifted it. */
  kind: "frozen" | "pushed" | "lifted";
  report_id: number | null;
  /** The vault batch of a push: `[from, to)` of the registry's vault list. */
  from: number | null;
  to: number | null;
  /** Whether the target is frozen after this event. */
  frozen_after: boolean;
}

export interface HeartbeatItem extends ChainRef {
  registry: string;
  attestor: string;
  /** The block the attestor recorded. */
  heartbeat_block: number;
}

/** An attestor's current state, from its registration, heartbeats, assignments, reports and slashing. */
export interface AttestorItem extends ChainRef {
  registry: string;
  attestor: string;
  signing_key: string;
  /** Zero after a slash. */
  bond: string;
  registered_block: number;
  last_heartbeat_block: number;
  /** A bond above zero and a heartbeat within the staleness bound, as of `last_indexed_block`. */
  alive: boolean;
  /** The targets this attestor is assigned to now. */
  targets: string[];
  reports_filed: number;
  /** Total bond slashed from it. */
  slashed: string;
}

/** One `target_classified`: the registry's record of a target's class at that block. */
export interface ClassItem extends ChainRef {
  registry: string;
  target: string;
  class: string;
  /** The class before this record, or null for the first. A different value is a class change. */
  previous_class: string | null;
  evidence_hash: string;
  classified_at_block: number;
  classifier: string;
  frozen: boolean;
  resolved_code_hash: string | null;
  upgrade_authority: string | null;
}

export interface CoveragesQuery extends PageQuery {
  pool?: string;
  vault?: string;
  owner?: string;
  agent?: string;
  target?: string;
  token?: TokenKey;
  status?: CoverageStatus;
}
export interface ClaimsQuery extends PageQuery {
  pool?: string;
  vault?: string;
  coverage?: number;
  outcome?: "paid" | "rejected";
}
export interface ReportsQuery extends PageQuery {
  registry?: string;
  target?: string;
  attestor?: string;
  state?: ReportState;
}
export interface FreezesQuery extends PageQuery {
  registry?: string;
  target?: string;
}
export interface HeartbeatsQuery extends PageQuery {
  registry?: string;
  attestor?: string;
  /** The heartbeats of the attestor assigned to this target now. */
  target?: string;
}
export interface AttestorsQuery extends PageQuery {
  registry?: string;
  attestor?: string;
}
export interface ClassesQuery extends PageQuery {
  registry?: string;
  target?: string;
}

export const COVERAGE_STATUSES = ["waiting", "active", "expired", "released"] as const;
export const CLAIM_OUTCOMES = ["paid", "rejected"] as const;
export const REPORT_STATES = ["pending", "disputed", "verified", "rejected"] as const;

export const ROUTES = {
  health: "/health",
  vaults: "/v1/vaults",
  activity: (vault: string) => `/v1/vaults/${encodeURIComponent(vault)}/activity`,
  exposure: (vault: string) => `/v1/vaults/${encodeURIComponent(vault)}/exposure`,
  events: "/v1/events",
  coverages: "/v1/coverages",
  claims: "/v1/claims",
  reports: "/v1/reports",
  freezes: "/v1/freezes",
  heartbeats: "/v1/heartbeats",
  attestors: "/v1/attestors",
  classes: "/v1/classes",
} as const;

/** The page size the server uses for a requested `limit`. */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}
