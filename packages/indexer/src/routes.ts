// Maps the read contract's routes onto the store (plan U3, KTD4). GET only, open CORS, no auth.

import { ROUTES, type ActivityKind } from "./api.js";
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

export function handle(store: Store, method: string, rawUrl: string): Reply {
  if (method === "OPTIONS") return { status: 204, headers: CORS, body: "" };
  if (method !== "GET") return json(405, { error: "the indexer API is read-only: GET only" });

  const url = new URL(rawUrl, "http://indexer.local");
  const p = url.searchParams;
  try {
    const page = { after: int(p, "after"), limit: int(p, "limit") };
    if (url.pathname === ROUTES.health) return json(200, store.health());
    if (url.pathname === ROUTES.vaults) return json(200, store.vaults({ ...page, owner: text(p, "owner"), operator: text(p, "operator"), code_hash: text(p, "code_hash") }));
    if (url.pathname === ROUTES.events)
      return json(
        200,
        store.events({ ...page, contract: text(p, "contract"), event: text(p, "event"), vault: text(p, "vault"), target: text(p, "target"), attestor: text(p, "attestor"), coverage: int(p, "coverage") }),
      );
    const m = VAULT_SUBROUTE.exec(url.pathname);
    if (m) {
      const vault = decodeURIComponent(m[1]);
      if (m[2] === "activity") return json(200, store.activity(vault, { ...page, agent: text(p, "agent"), kind: text(p, "kind") as ActivityKind | undefined }));
      return json(200, store.exposure(vault, { ...page, agent: text(p, "agent"), target: text(p, "target"), token: text(p, "token") }));
    }
    return json(404, { error: `no route ${url.pathname}` });
  } catch (e) {
    if (e instanceof BadQuery || e instanceof URIError) return json(400, { error: e.message });
    throw e;
  }
}
