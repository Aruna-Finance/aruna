// Typed client for the indexer's read API (plan U1). Browser-safe: it only needs `fetch`. A failure
// to reach the indexer, or an answer that is not a valid page, is an IndexerUnavailableError, so a
// caller can always tell "history unavailable" from "no history" (R10).

import { ROUTES } from "./api.js";
import type { ActivityItem, ActivityQuery, EventItem, EventsQuery, ExposureQuery, ExposureRow, Health, Page, VaultSummary, VaultsQuery } from "./api.js";

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

type Query = Record<string, string | number | undefined>;

export function createIndexerClient(o: { baseUrl: string; fetch?: typeof globalThis.fetch }): IndexerClient {
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
  };
}
