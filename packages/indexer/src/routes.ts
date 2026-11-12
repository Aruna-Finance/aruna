// Maps the read contract's routes onto the store (plan U3, KTD4). GET only, open CORS, no auth.

import { ACTIVITY_KINDS, CLAIM_OUTCOMES, COVERAGE_STATUSES, REPORT_STATES, ROUTES, type ActivityKind, type Health } from "./api.js";
import type { Store } from "./store.js";

export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const json = (status: number, value: unknown): Reply => ({
  status,
  headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(value),
});

class BadQuery extends Error {}

/** `/v1/vaults/:vault/activity` and `/v1/vaults/:vault/exposure`, as ROUTES builds them. */
const VAULT_SUBROUTE = new RegExp(`^${ROUTES.vaults}/([^/]+)/(activity|exposure)$`);

function int(params: URLSearchParams, key: string): number | undefined {
  const v = params.get(key);
  if (v === null || v === "") return undefined;
  if (!/^-?\d+$/.test(v)) throw new BadQuery(`${key} must be an integer`);
  return Number(v);
}

const text = (params: URLSearchParams, key: string) => params.get(key) || undefined;

function kind(params: URLSearchParams): ActivityKind | undefined {
  const v = text(params, "kind");
  if (v !== undefined && !(ACTIVITY_KINDS as readonly string[]).includes(v)) throw new BadQuery(`kind must be one of ${ACTIVITY_KINDS.join(", ")}`);
  return v as ActivityKind | undefined;
}

/** A query value that must be one of a fixed list. */
function oneOf<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T | undefined {
  const v = text(params, key);
  if (v !== undefined && !(allowed as readonly string[]).includes(v)) throw new BadQuery(`${key} must be one of ${allowed.join(", ")}`);
  return v as T | undefined;
}

/** How long /health waits for the database before it answers unhealthy (plan KTD7); a hung connection must not hang the healthcheck. */
export const HEALTH_TIMEOUT_MS = 2_000;

/** What /health says when the database is not open yet or does not answer: unhealthy, with nothing the database would have supplied. */
const UNAVAILABLE: Health = { last_indexed_block: 0, head_block: null, lag_blocks: null, head_seen_ms_ago: null, unparsed_events: 0, healthy: false };

async function healthOf(store: Store | null): Promise<Health> {
  if (!store) return UNAVAILABLE;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      store.health(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("the database did not answer in time")), HEALTH_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    console.error(`health: ${e instanceof Error ? e.message : String(e)}`);
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}

export async function handle(store: Store | null, method: string, rawUrl: string): Promise<Reply> {
  if (method === "OPTIONS") return { status: 204, headers: CORS, body: "" };
  if (method !== "GET") return json(405, { error: "the indexer API is read-only: GET only" });

  const url = new URL(rawUrl, "http://indexer.local");
  const p = url.searchParams;
  try {
    const page = { after: int(p, "after"), limit: int(p, "limit") };
    if (url.pathname === ROUTES.health) return json(200, await healthOf(store));
    if (!store) return json(503, { error: "the database is not ready yet" });
    if (url.pathname === ROUTES.vaults) return json(200, await store.vaults({ ...page, owner: text(p, "owner"), operator: text(p, "operator"), code_hash: text(p, "code_hash") }));
    if (url.pathname === ROUTES.events)
      return json(
        200,
        await store.events({ ...page, contract: text(p, "contract"), event: text(p, "event"), vault: text(p, "vault"), target: text(p, "target"), attestor: text(p, "attestor"), coverage: int(p, "coverage") }),
      );
    if (url.pathname === ROUTES.coverages)
      return json(200, await store.coverages({ ...page, pool: text(p, "pool"), vault: text(p, "vault"), owner: text(p, "owner"), agent: text(p, "agent"), target: text(p, "target"), token: text(p, "token"), status: oneOf(p, "status", COVERAGE_STATUSES) }));
    if (url.pathname === ROUTES.claims) return json(200, await store.claims({ ...page, pool: text(p, "pool"), vault: text(p, "vault"), coverage: int(p, "coverage"), outcome: oneOf(p, "outcome", CLAIM_OUTCOMES) }));
    if (url.pathname === ROUTES.reports) return json(200, await store.reports({ ...page, registry: text(p, "registry"), target: text(p, "target"), attestor: text(p, "attestor"), state: oneOf(p, "state", REPORT_STATES) }));
    if (url.pathname === ROUTES.freezes) return json(200, await store.freezes({ ...page, registry: text(p, "registry"), target: text(p, "target") }));
    if (url.pathname === ROUTES.heartbeats) return json(200, await store.heartbeats({ ...page, registry: text(p, "registry"), attestor: text(p, "attestor"), target: text(p, "target") }));
    if (url.pathname === ROUTES.attestors) return json(200, await store.attestors({ ...page, registry: text(p, "registry"), attestor: text(p, "attestor") }));
    if (url.pathname === ROUTES.classes) return json(200, await store.classes({ ...page, registry: text(p, "registry"), target: text(p, "target") }));
    const m = VAULT_SUBROUTE.exec(url.pathname);
    if (m) {
      const vault = decodeURIComponent(m[1]);
      if (m[2] === "activity") return json(200, await store.activity(vault, { ...page, agent: text(p, "agent"), kind: kind(p) }));
      return json(200, await store.exposure(vault, { ...page, agent: text(p, "agent"), target: text(p, "target"), token: text(p, "token") }));
    }
    return json(404, { error: `no route ${url.pathname}` });
  } catch (e) {
    if (e instanceof BadQuery || e instanceof URIError) return json(400, { error: e.message });
    throw e;
  }
}
