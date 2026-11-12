// Typed client for the indexer's read API (plan U1). Browser-safe: it only needs `fetch`. A failure
// to reach the indexer, or an answer that is not a valid page, is an IndexerUnavailableError, so a
// caller can always tell "history unavailable" from "no history" (R10).

import { ROUTES } from "./api.js";
import type {
  ActivityItem,
  ActivityQuery,
  AttestorItem,
  AttestorsQuery,
  ClaimItem,
  ClaimsQuery,
  ClassItem,
  ClassesQuery,
  CoverageItem,
  CoveragesQuery,
  EventItem,
  EventsQuery,
  ExposureQuery,
  ExposureRow,
  FreezeItem,
  FreezesQuery,
  Health,
  HeartbeatItem,
  HeartbeatsQuery,
  Page,
  ReportItem,
  ReportsQuery,
  VaultSummary,
  VaultsQuery,
} from "./api.js";

export * from "./api.js";

export class IndexerUnavailableError extends Error {
  constructor(
    readonly reason: "network" | "http" | "malformed",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "IndexerUnavailableError";
  }
}

export interface IndexerClient {
  health(): Promise<Health>;
  vaults(q?: VaultsQuery): Promise<Page<VaultSummary>>;
  activity(vault: string, q?: ActivityQuery): Promise<Page<ActivityItem>>;
  exposure(vault: string, q?: ExposureQuery): Promise<Page<ExposureRow>>;
  events(q?: EventsQuery): Promise<Page<EventItem>>;
}

/**
 * Coverage, claims, drift reports, freezes, heartbeats, attestors and class changes (R7). A separate interface from
 * `IndexerClient`, so a caller that only knows the first routes (the console's recorded fixture, a test double) keeps
 * compiling: `createIndexerClient` returns both.
 */
export interface CoverageDriftClient {
  /** Coverage sold by a pool, with what claims did to it and its status as of `last_indexed_block`. */
  coverages(q?: CoveragesQuery): Promise<Page<CoverageItem>>;
  /** Claim attempts, paid and refused, with every term of a payout. */
  claims(q?: ClaimsQuery): Promise<Page<ClaimItem>>;
  /** Signed drift reports with their state after any dispute and ruling. */
  reports(q?: ReportsQuery): Promise<Page<ReportItem>>;
  freezes(q?: FreezesQuery): Promise<Page<FreezeItem>>;
  heartbeats(q?: HeartbeatsQuery): Promise<Page<HeartbeatItem>>;
  attestors(q?: AttestorsQuery): Promise<Page<AttestorItem>>;
  /** The registry's class records for a target, oldest first; a changed `class` is a class change. */
  classes(q?: ClassesQuery): Promise<Page<ClassItem>>;
}

type Query = Record<string, string | number | undefined>;

export function createIndexerClient(o: { baseUrl: string; fetch?: typeof globalThis.fetch }): IndexerClient & CoverageDriftClient {
  const base = o.baseUrl.replace(/\/+$/, "");
  const doFetch = o.fetch ?? globalThis.fetch.bind(globalThis);

  async function get(path: string, query: Query = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
    const qs = params.toString();
    const url = `${base}${path}${qs ? `?${qs}` : ""}`;
    let res: Response;
    try {
      res = await doFetch(url);
    } catch (e) {
      throw new IndexerUnavailableError("network", `indexer unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new IndexerUnavailableError("http", `indexer answered ${res.status}`, res.status);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new IndexerUnavailableError("malformed", "indexer answered with a body that is not JSON");
    }
    if (typeof body !== "object" || body === null || typeof (body as { last_indexed_block?: unknown }).last_indexed_block !== "number") {
      throw new IndexerUnavailableError("malformed", "indexer answer has no last_indexed_block");
    }
    return body as Record<string, unknown>;
  }

  async function page<T>(path: string, query: Query): Promise<Page<T>> {
    const body = await get(path, query);
    if (!Array.isArray(body.items)) throw new IndexerUnavailableError("malformed", "indexer page has no items array");
    return body as unknown as Page<T>;
  }

  return {
    health: async () => (await get(ROUTES.health)) as unknown as Health,
    vaults: (q = {}) => page<VaultSummary>(ROUTES.vaults, { ...q }),
    activity: (vault, q = {}) => page<ActivityItem>(ROUTES.activity(vault), { ...q }),
    exposure: (vault, q = {}) => page<ExposureRow>(ROUTES.exposure(vault), { ...q }),
    events: (q = {}) => page<EventItem>(ROUTES.events, { ...q }),
    coverages: (q = {}) => page<CoverageItem>(ROUTES.coverages, { ...q }),
    claims: (q = {}) => page<ClaimItem>(ROUTES.claims, { ...q }),
    reports: (q = {}) => page<ReportItem>(ROUTES.reports, { ...q }),
    freezes: (q = {}) => page<FreezeItem>(ROUTES.freezes, { ...q }),
    heartbeats: (q = {}) => page<HeartbeatItem>(ROUTES.heartbeats, { ...q }),
    attestors: (q = {}) => page<AttestorItem>(ROUTES.attestors, { ...q }),
    classes: (q = {}) => page<ClassItem>(ROUTES.classes, { ...q }),
  };
}
