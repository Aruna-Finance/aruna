// One SQLite file: raw chain records plus the tables derived from them (plan KTD3). A block is
// committed in one transaction with the cursor, so a crash never leaves half a block behind.

import { DatabaseSync } from "node:sqlite";
import { CHALLENGE_WINDOW_BLOCKS, HEARTBEAT_STALE_BLOCKS, clampLimit } from "./api.js";
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
CREATE TABLE IF NOT EXISTS coverages (
  seq INTEGER PRIMARY KEY, pool TEXT NOT NULL, id INTEGER NOT NULL, owner TEXT, vault TEXT, agent TEXT, target TEXT, token TEXT, limit_amount TEXT, payout_ratio_bps INTEGER,
  premium_paid TEXT, class TEXT, code_hash TEXT, upgrade_authority TEXT, start_block INTEGER, waiting_period_ends INTEGER, end_block INTEGER, policy_version INTEGER, daily_cap_priced TEXT,
  paid_out TEXT NOT NULL DEFAULT '0', claims_paid INTEGER NOT NULL DEFAULT 0, claims_rejected INTEGER NOT NULL DEFAULT 0, released INTEGER NOT NULL DEFAULT 0,
  block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, UNIQUE (pool, id)
);
CREATE INDEX IF NOT EXISTS coverages_vault ON coverages (vault, seq);
CREATE TABLE IF NOT EXISTS claims (
  seq INTEGER PRIMARY KEY, pool TEXT NOT NULL, coverage INTEGER NOT NULL, report INTEGER, outcome TEXT NOT NULL, reason TEXT, payout TEXT, exposure_in_window TEXT,
  exposure_before_change TEXT, exposure_through_last_paid_block TEXT, payout_ratio_bps INTEGER, limit_amount TEXT, paid_before TEXT, to_account TEXT, token TEXT,
  vault TEXT, target TEXT, owner TEXT, block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS claims_coverage ON claims (pool, coverage, seq);
CREATE TABLE IF NOT EXISTS reports (
  seq INTEGER PRIMARY KEY, registry TEXT NOT NULL, id INTEGER NOT NULL, target TEXT NOT NULL, attestor TEXT, observed_at_block INTEGER, changed_at_block INTEGER, before_ref TEXT, after_ref TEXT,
  before_resolved_hash TEXT, after_resolved_hash TEXT, channel TEXT, nonce INTEGER, expires_at INTEGER, reported_at_block INTEGER NOT NULL, state TEXT NOT NULL, disputed_by INTEGER,
  block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, UNIQUE (registry, id)
);
CREATE INDEX IF NOT EXISTS reports_target ON reports (target, seq);
CREATE TABLE IF NOT EXISTS freezes (
  seq INTEGER PRIMARY KEY, registry TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, report_id INTEGER, from_index INTEGER, to_index INTEGER, frozen_after INTEGER NOT NULL,
  block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS freezes_target ON freezes (registry, target, seq);
CREATE TABLE IF NOT EXISTS heartbeats (
  seq INTEGER PRIMARY KEY, registry TEXT NOT NULL, attestor TEXT NOT NULL, heartbeat_block INTEGER NOT NULL,
  block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attestors (
  seq INTEGER PRIMARY KEY, registry TEXT NOT NULL, attestor TEXT NOT NULL, signing_key TEXT, bond TEXT NOT NULL, registered_block INTEGER NOT NULL, last_heartbeat_block INTEGER NOT NULL,
  reports_filed INTEGER NOT NULL DEFAULT 0, slashed TEXT NOT NULL DEFAULT '0', block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL,
  UNIQUE (registry, attestor)
);
CREATE TABLE IF NOT EXISTS assignments (registry TEXT NOT NULL, target TEXT NOT NULL, attestor TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (registry, target));
CREATE TABLE IF NOT EXISTS classes (
  seq INTEGER PRIMARY KEY, registry TEXT NOT NULL, target TEXT NOT NULL, class TEXT NOT NULL, previous_class TEXT, evidence_hash TEXT, classified_at_block INTEGER, classifier TEXT,
  frozen INTEGER NOT NULL, resolved_code_hash TEXT, upgrade_authority TEXT, block INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS classes_target ON classes (registry, target, seq);
`;

/** Every table that is a function of `raw`. Bumping DERIVED_VERSION rebuilds all of them from `raw` on the next open. */
const DERIVED_TABLES = ["creates", "vaults", "activity", "exposure", "events", "coverages", "claims", "reports", "freezes", "heartbeats", "attestors", "assignments", "classes"];
/** 1: vaults, activity, exposure, events. 2: coverages, claims, reports, freezes, heartbeats, attestors, classes. */
const DERIVED_VERSION = 2;

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
  coverages(q?: CoveragesQuery): Page<CoverageItem>;
  claims(q?: ClaimsQuery): Page<ClaimItem>;
  reports(q?: ReportsQuery): Page<ReportItem>;
  freezes(q?: FreezesQuery): Page<FreezeItem>;
  heartbeats(q?: HeartbeatsQuery): Page<HeartbeatItem>;
  attestors(q?: AttestorsQuery): Page<AttestorItem>;
  classes(q?: ClassesQuery): Page<ClassItem>;
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

  // The derived tables are a function of `raw` (KTD3). A store made before a derived table existed has the
  // raw events but not the table, so when the version moves, every derived table is rebuilt from `raw`,
  // in seq order, in one transaction. A store that is empty just records the version.
  if (getMeta("derived_version") !== String(DERIVED_VERSION)) {
    db.exec("BEGIN");
    try {
      for (const t of DERIVED_TABLES) db.exec(`DELETE FROM ${t}`);
      const rows = db.prepare("SELECT * FROM raw ORDER BY seq").all() as Row[];
      for (const r of rows) {
        applyRecord(db, Number(r.seq), {
          kind: r.kind as RawRecord["kind"],
          contract: String(r.contract),
          name: (r.name as string | null) ?? null,
          data: JSON.parse(String(r.data)) as Record<string, unknown>,
          block: Number(r.block),
          timestamp_ms: Number(r.timestamp_ms),
          tx_hash: String(r.tx_hash),
          receipt_id: String(r.receipt_id),
          idx: Number(r.idx),
        });
      }
      setMeta("derived_version", String(DERIVED_VERSION));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  /** `extra` is one more condition, with its own arguments, for filters that depend on the cursor (a status the clock decides). */
  function page<T>(table: string, filters: Filters, q: { after?: number; limit?: number }, map: (r: Row) => T, extra?: { sql: string; args: unknown[] }): Page<T> {
    const limit = clampLimit(q.limit);
    const where: string[] = ["seq > ?"];
    const args: unknown[] = [q.after ?? -1];
    for (const [clause, value] of filters) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        // An empty list matches nothing; `IN ()` is not valid SQL.
        where.push(value.length === 0 ? "1 = 0" : `${clause} IN (${value.map(() => "?").join(", ")})`);
        args.push(...value);
      } else {
        where.push(`${clause} = ?`);
        args.push(value);
      }
    }
    if (extra) {
      where.push(extra.sql);
      args.push(...extra.args);
    }
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${where.join(" AND ")} ORDER BY seq LIMIT ?`).all(...(args as never[]), limit + 1) as Row[];
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
  const lastBlock = () => cursor() ?? 0;
  const coverageRow = (r: Row): CoverageItem => {
    const last = lastBlock();
    const released = Number(r.released) === 1;
    return {
      ...ref(r),
      pool: String(r.pool),
      id: Number(r.id),
      owner: String(r.owner),
      vault: String(r.vault),
      agent: String(r.agent),
      target: String(r.target),
      token: String(r.token),
      limit: String(r.limit_amount),
      payout_ratio_bps: Number(r.payout_ratio_bps),
      premium_paid: String(r.premium_paid),
      class: String(r.class),
      code_hash: String(r.code_hash),
      upgrade_authority: String(r.upgrade_authority),
      start_block: Number(r.start_block),
      waiting_period_ends: Number(r.waiting_period_ends),
      end_block: Number(r.end_block),
      policy_version: Number(r.policy_version),
      daily_cap_priced: String(r.daily_cap_priced),
      paid_out: String(r.paid_out),
      claims_paid: Number(r.claims_paid),
      claims_rejected: Number(r.claims_rejected),
      released,
      status: released ? "released" : last < Number(r.waiting_period_ends) ? "waiting" : last <= Number(r.end_block) ? "active" : "expired",
    };
  };
  const text = (x: unknown) => (x === null || x === undefined ? null : String(x));
  const claimRow = (r: Row): ClaimItem => ({
    ...ref(r),
    pool: String(r.pool),
    coverage: Number(r.coverage),
    report: Number(r.report),
    outcome: r.outcome as ClaimItem["outcome"],
    reason: text(r.reason),
    payout: text(r.payout),
    exposure_in_window: text(r.exposure_in_window),
    exposure_before_change: text(r.exposure_before_change),
    exposure_through_last_paid_block: text(r.exposure_through_last_paid_block),
    payout_ratio_bps: r.payout_ratio_bps === null ? null : Number(r.payout_ratio_bps),
    limit: text(r.limit_amount),
    paid_before: text(r.paid_before),
    to: text(r.to_account),
    token: text(r.token),
    vault: text(r.vault),
    target: text(r.target),
    owner: text(r.owner),
  });
  const reportRow = (r: Row): ReportItem => {
    const reported = Number(r.reported_at_block);
    const stored = String(r.state);
    return {
      ...ref(r),
      registry: String(r.registry),
      id: Number(r.id),
      target: String(r.target),
      attestor: String(r.attestor),
      observed_at_block: Number(r.observed_at_block),
      changed_at_block: Number(r.changed_at_block),
      before_ref: JSON.parse(String(r.before_ref)) as unknown,
      after_ref: JSON.parse(String(r.after_ref)) as unknown,
      before_resolved_hash: String(r.before_resolved_hash),
      after_resolved_hash: String(r.after_resolved_hash),
      channel: String(r.channel),
      nonce: Number(r.nonce),
      expires_at: Number(r.expires_at),
      reported_at_block: reported,
      disputed_by: r.disputed_by === null ? null : Number(r.disputed_by),
      state: (stored === "pending" && lastBlock() >= reported + CHALLENGE_WINDOW_BLOCKS ? "verified" : stored) as ReportItem["state"],
      challenge_window_ends: reported + CHALLENGE_WINDOW_BLOCKS,
    };
  };
  const freezeRow = (r: Row): FreezeItem => ({
    ...ref(r),
    registry: String(r.registry),
    target: String(r.target),
    kind: r.kind as FreezeItem["kind"],
    report_id: r.report_id === null ? null : Number(r.report_id),
    from: r.from_index === null ? null : Number(r.from_index),
    to: r.to_index === null ? null : Number(r.to_index),
    frozen_after: Number(r.frozen_after) === 1,
  });
  const heartbeatRow = (r: Row): HeartbeatItem => ({ ...ref(r), registry: String(r.registry), attestor: String(r.attestor), heartbeat_block: Number(r.heartbeat_block) });
  const attestorRow = (r: Row): AttestorItem => {
    const targets = (db.prepare("SELECT target FROM assignments WHERE registry = ? AND attestor = ? ORDER BY target").all(r.registry as string, r.attestor as string) as Row[]).map((x) => String(x.target));
    const sinceBeat = Math.max(0, lastBlock() - Number(r.last_heartbeat_block));
    return {
      ...ref(r),
      registry: String(r.registry),
      attestor: String(r.attestor),
      signing_key: String(r.signing_key),
      bond: String(r.bond),
      registered_block: Number(r.registered_block),
      last_heartbeat_block: Number(r.last_heartbeat_block),
      alive: BigInt(String(r.bond)) > 0n && sinceBeat <= HEARTBEAT_STALE_BLOCKS,
      targets,
      reports_filed: Number(r.reports_filed),
      slashed: String(r.slashed),
    };
  };
  const classRow = (r: Row): ClassItem => ({
    ...ref(r),
    registry: String(r.registry),
    target: String(r.target),
    class: String(r.class),
    previous_class: text(r.previous_class),
    evidence_hash: String(r.evidence_hash),
    classified_at_block: Number(r.classified_at_block),
    classifier: String(r.classifier),
    frozen: Number(r.frozen) === 1,
    resolved_code_hash: text(r.resolved_code_hash),
    upgrade_authority: text(r.upgrade_authority),
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
    coverages(q = {}) {
      const L = lastBlock();
      const status: Record<string, { sql: string; args: unknown[] }> = {
        released: { sql: "released = 1", args: [] },
        waiting: { sql: "released = 0 AND ? < waiting_period_ends", args: [L] },
        active: { sql: "released = 0 AND ? >= waiting_period_ends AND ? <= end_block", args: [L, L] },
        expired: { sql: "released = 0 AND ? > end_block", args: [L] },
      };
      return page("coverages", [["pool", q.pool], ["vault", q.vault], ["owner", q.owner], ["agent", q.agent], ["target", q.target], ["token", q.token]], q, coverageRow, q.status ? status[q.status] : undefined);
    },
    claims: (q = {}) => page("claims", [["pool", q.pool], ["vault", q.vault], ["coverage", q.coverage], ["outcome", q.outcome]], q, claimRow),
    reports(q = {}) {
      const L = lastBlock();
      const state: Record<string, { sql: string; args: unknown[] }> = {
        pending: { sql: "state = 'pending' AND ? < reported_at_block + ?", args: [L, CHALLENGE_WINDOW_BLOCKS] },
        verified: { sql: "(state = 'verified' OR (state = 'pending' AND ? >= reported_at_block + ?))", args: [L, CHALLENGE_WINDOW_BLOCKS] },
        disputed: { sql: "state = 'disputed'", args: [] },
        rejected: { sql: "state = 'rejected'", args: [] },
      };
      return page("reports", [["registry", q.registry], ["target", q.target], ["attestor", q.attestor]], q, reportRow, q.state ? state[q.state] : undefined);
    },
    freezes: (q = {}) => page("freezes", [["registry", q.registry], ["target", q.target]], q, freezeRow),
    heartbeats(q = {}) {
      // "Per target" means the attestor assigned to it now.
      const assigned = q.target === undefined ? undefined : (db.prepare("SELECT attestor FROM assignments WHERE target = ?" + (q.registry ? " AND registry = ?" : "")).all(...((q.registry ? [q.target, q.registry] : [q.target]) as string[])) as Row[]).map((x) => String(x.attestor));
      const attestor = q.attestor !== undefined && assigned !== undefined ? assigned.filter((a) => a === q.attestor) : assigned ?? q.attestor;
      return page("heartbeats", [["registry", q.registry], ["attestor", attestor]], q, heartbeatRow);
    },
    attestors: (q = {}) => page("attestors", [["registry", q.registry], ["attestor", q.attestor]], q, attestorRow),
    classes: (q = {}) => page("classes", [["registry", q.registry], ["target", q.target]], q, classRow),
    export() {
      const all = (sql: string) => db.prepare(sql).all() as Row[];
      return JSON.stringify(
        canonical({
          vaults: all("SELECT * FROM vaults ORDER BY seq").map(vaultRow),
          activity: all("SELECT * FROM activity ORDER BY seq").map(activityRow),
          exposure: all("SELECT * FROM exposure ORDER BY seq").map(exposureRow),
          events: all("SELECT * FROM events ORDER BY seq").map(eventRow),
          coverages: all("SELECT * FROM coverages ORDER BY seq").map(coverageRow),
          claims: all("SELECT * FROM claims ORDER BY seq").map(claimRow),
          reports: all("SELECT * FROM reports ORDER BY seq").map(reportRow),
          freezes: all("SELECT * FROM freezes ORDER BY seq").map(freezeRow),
          heartbeats: all("SELECT * FROM heartbeats ORDER BY seq").map(heartbeatRow),
          attestors: all("SELECT * FROM attestors ORDER BY seq").map(attestorRow),
          classes: all("SELECT * FROM classes ORDER BY seq").map(classRow),
          unparsed: all("SELECT seq, contract, name, data, block, tx_hash FROM raw WHERE kind = 'unparsed' ORDER BY seq"),
        }),
      );
    },
    close: () => db.close(),
  };
}
