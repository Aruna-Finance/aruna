// One SQLite file: raw chain records plus the tables derived from them (plan KTD3). A block is
// committed in one transaction with the cursor, so a crash never leaves half a block behind.

import { DatabaseSync } from "node:sqlite";
import { clampLimit } from "./api.js";
import type { ActivityItem, ActivityQuery, EventItem, EventsQuery, ExposureQuery, ExposureRow, Health, Page, VaultSummary, VaultsQuery } from "./api.js";
import { applyRecord } from "./derive.js";
import type { RawRecord } from "./ingest/parse.js";

/** A head lag above this many blocks reports the indexer as not healthy (about a minute on testnet). */
export const HEALTHY_LAG_BLOCKS = 60;
/** A head last read longer ago than this means ingest has stopped reading the chain. */
export const HEAD_STALE_MS = 120_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS raw (
  seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, contract TEXT NOT NULL, name TEXT, data TEXT NOT NULL,
  block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, idx INTEGER NOT NULL,
  UNIQUE (receipt_id, kind, idx)
);
CREATE TABLE IF NOT EXISTS creates (vault TEXT NOT NULL, tx_hash TEXT NOT NULL, owner TEXT, operator TEXT, seq INTEGER NOT NULL, PRIMARY KEY (vault, tx_hash));
CREATE TABLE IF NOT EXISTS vaults (
  vault TEXT PRIMARY KEY, factory TEXT NOT NULL, owner TEXT, operator TEXT, code_hash TEXT,
  created_block INTEGER NOT NULL, created_tx TEXT NOT NULL, seq INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  seq INTEGER PRIMARY KEY, vault TEXT NOT NULL, agent TEXT, kind TEXT NOT NULL, event TEXT NOT NULL, target TEXT, amount TEXT,
  token TEXT, reason TEXT, class TEXT, block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_vault ON activity (vault, seq);
CREATE TABLE IF NOT EXISTS exposure (
  seq INTEGER PRIMARY KEY, vault TEXT NOT NULL, agent TEXT NOT NULL, target TEXT NOT NULL, token TEXT NOT NULL, amount TEXT NOT NULL,
  total TEXT NOT NULL, class TEXT, block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS exposure_vault ON exposure (vault, seq);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY, contract TEXT NOT NULL, event TEXT NOT NULL, block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL,
  tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, data TEXT NOT NULL,
  ref_vault TEXT, ref_target TEXT, ref_attestor TEXT, ref_coverage INTEGER
);
CREATE INDEX IF NOT EXISTS events_event ON events (event, seq);
`;

type Row = Record<string, unknown>;
type Filters = Array<[string, unknown]>;

export interface Store {
  /** The last block committed, or null before the first. */
  cursor(): number | null;
  commitBlock(height: number, records: RawRecord[]): void;
  knownVaults(): Array<{ vault: string; factory: string }>;
  setHead(height: number): void;
  /** Names the block source now serving blocks, for /health. Kept in memory only. */
  setSource(label: string): void;
  health(head?: number | null): Health;
  vaults(q?: VaultsQuery): Page<VaultSummary>;
  activity(vault: string, q?: ActivityQuery): Page<ActivityItem>;
  exposure(vault: string, q?: ExposureQuery): Page<ExposureRow>;
  events(q?: EventsQuery): Page<EventItem>;
  /** Canonical JSON of every derived table, for comparing two stores (R2). */
  export(): string;
  close(): void;
}

/** Stable key order, so two stores with the same rows export the same bytes. */
function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical);
  if (typeof x === "object" && x !== null) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical((x as Row)[k])]));
  return x;
}

export function openStore(path: string, o: { now?: () => number } = {}): Store {
  const now = o.now ?? Date.now;
  let headSeenAt: number | null = null;
  let source: string | undefined;
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  const getMeta = (k: string) => (db.prepare("SELECT value FROM meta WHERE key = ?").get(k) as { value: string } | undefined)?.value ?? null;
  const setMeta = (k: string, v: string) => db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(k, v);
  const cursor = () => {
    const v = getMeta("cursor");
    return v === null ? null : Number(v);
  };

  function page<T>(table: string, filters: Filters, q: { after?: number; limit?: number }, map: (r: Row) => T, extra = ""): Page<T> {
    const limit = clampLimit(q.limit);
    const where: string[] = ["seq > ?"];
    const args: unknown[] = [q.after ?? -1];
    for (const [clause, value] of filters) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        where.push(`${clause} IN (${value.map(() => "?").join(", ")})`);
        args.push(...value);
      } else {
        where.push(`${clause} = ?`);
        args.push(value);
      }
    }
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${where.join(" AND ")}${extra} ORDER BY seq LIMIT ?`).all(...(args as never[]), limit + 1) as Row[];
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map(map);
    return { last_indexed_block: cursor() ?? 0, items, next_after: more ? Number(rows[limit - 1].seq) : null };
  }

  const ref = (r: Row) => ({ seq: Number(r.seq), block: Number(r.block), timestamp_ms: Number(r.timestamp_ms), tx_hash: String(r.tx_hash), receipt_id: String(r.receipt_id) });
  const vaultRow = (r: Row): VaultSummary => ({
    vault: String(r.vault),
    factory: String(r.factory),
    owner: String(r.owner),
    operator: (r.operator as string | null) ?? null,
    code_hash: String(r.code_hash),
    created_block: Number(r.created_block),
    created_tx: String(r.created_tx),
  });
  const activityRow = (r: Row): ActivityItem => ({
    ...ref(r),
    kind: r.kind as ActivityItem["kind"],
    event: String(r.event),
    vault: String(r.vault),
    agent: (r.agent as string | null) ?? null,
    target: (r.target as string | null) ?? null,
    amount: (r.amount as string | null) ?? null,
    token: (r.token as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    class: (r.class as string | null) ?? null,
    data: JSON.parse(String(r.data)) as Record<string, unknown>,
  });
  const exposureRow = (r: Row): ExposureRow => ({
    ...ref(r),
    vault: String(r.vault),
    agent: String(r.agent),
    target: String(r.target),
    token: String(r.token),
    amount: String(r.amount),
    total: String(r.total),
    class: (r.class as string | null) ?? null,
  });
  const eventRow = (r: Row): EventItem => ({ ...ref(r), contract: String(r.contract), event: String(r.event), data: JSON.parse(String(r.data)) as Record<string, unknown> });

  return {
    cursor,
    commitBlock(height, records) {
      const current = cursor();
      if (current !== null && height !== current + 1) throw new Error(`block ${height} is not next after cursor ${current}`);
      db.exec("BEGIN");
      try {
        const insert = db.prepare(
          "INSERT OR IGNORE INTO raw (kind, contract, name, data, block, timestamp_ms, tx_hash, receipt_id, idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        for (const rec of records) {
          const res = insert.run(rec.kind, rec.contract, rec.name, JSON.stringify(rec.data), rec.block, rec.timestamp_ms, rec.tx_hash, rec.receipt_id, rec.idx);
          if (res.changes === 0) continue;
          applyRecord(db, Number(res.lastInsertRowid), rec);
        }
        setMeta("cursor", String(height));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    knownVaults: () => (db.prepare("SELECT vault, factory FROM vaults ORDER BY seq").all() as Row[]).map((r) => ({ vault: String(r.vault), factory: String(r.factory) })),
    setHead(h) {
      headSeenAt = now();
      if (getMeta("head") !== String(h)) setMeta("head", String(h));
    },
    setSource(label) {
      source = label;
    },
    health(head) {
      const last = cursor() ?? 0;
      const stored = getMeta("head");
      const knownHead = head ?? (stored === null ? null : Number(stored));
      const lag = knownHead === null ? null : Math.max(0, knownHead - last);
      const seenAgo = head !== undefined && head !== null ? 0 : headSeenAt === null ? null : now() - headSeenAt;
      const unparsed = Number((db.prepare("SELECT COUNT(*) AS n FROM raw WHERE kind = 'unparsed'").get() as Row).n);
      const healthy = lag !== null && lag <= HEALTHY_LAG_BLOCKS && seenAgo !== null && seenAgo <= HEAD_STALE_MS;
      const mode = lag === null ? undefined : lag > HEALTHY_LAG_BLOCKS ? ("catching_up" as const) : ("following" as const);
      return { last_indexed_block: last, head_block: knownHead, lag_blocks: lag, head_seen_ms_ago: seenAgo, unparsed_events: unparsed, healthy, ...(source && { source }), ...(mode && { mode }) };
    },
    vaults: (q = {}) =>
      page("vaults", [["owner", q.owner], ["operator", q.operator], ["code_hash", q.code_hash]], q, vaultRow),
    activity: (vault, q = {}) => page("activity", [["vault", vault], ["agent", q.agent], ["kind", q.kind]], q, activityRow),
    exposure: (vault, q = {}) => page("exposure", [["vault", vault], ["agent", q.agent], ["target", q.target], ["token", q.token]], q, exposureRow),
    events: (q = {}) =>
      page(
        "events",
        [
          ["contract", q.contract],
          ["event", q.event ? q.event.split(",").map((s) => s.trim()).filter(Boolean) : undefined],
          ["ref_vault", q.vault],
          ["ref_target", q.target],
          ["ref_attestor", q.attestor],
          ["ref_coverage", q.coverage],
        ],
        q,
        eventRow,
      ),
    export() {
      const all = (sql: string) => db.prepare(sql).all() as Row[];
      return JSON.stringify(
        canonical({
          vaults: all("SELECT * FROM vaults ORDER BY seq").map(vaultRow),
          activity: all("SELECT * FROM activity ORDER BY seq").map(activityRow),
          exposure: all("SELECT * FROM exposure ORDER BY seq").map(exposureRow),
          events: all("SELECT * FROM events ORDER BY seq").map(eventRow),
          unparsed: all("SELECT seq, contract, name, data, block, tx_hash FROM raw WHERE kind = 'unparsed' ORDER BY seq"),
        }),
      );
    },
    close: () => db.close(),
  };
}
