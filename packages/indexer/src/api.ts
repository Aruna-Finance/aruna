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

export const ROUTES = {
  health: "/health",
  vaults: "/v1/vaults",
  activity: (vault: string) => `/v1/vaults/${encodeURIComponent(vault)}/activity`,
  exposure: (vault: string) => `/v1/vaults/${encodeURIComponent(vault)}/exposure`,
  events: "/v1/events",
} as const;

/** The page size the server uses for a requested `limit`. */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}
