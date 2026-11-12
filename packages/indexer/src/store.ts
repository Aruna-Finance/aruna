// The indexer's state in Postgres: raw chain records plus the tables derived from them (plan KTD3). A window of blocks is
// committed in one transaction with the cursor, so a crash never leaves half a window behind, and only if the stored
// cursor is the one this process holds, so a second writer during a deploy overlap can neither lose nor double a block (KTD5).

import type { Db, Queryable, Row } from "./db.js";
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

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS raw (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, kind TEXT NOT NULL, contract TEXT NOT NULL, name TEXT, data TEXT NOT NULL,
  block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, idx BIGINT NOT NULL,
  UNIQUE (receipt_id, kind, idx)
)`,
  `CREATE TABLE IF NOT EXISTS creates (vault TEXT NOT NULL, tx_hash TEXT NOT NULL, owner TEXT, operator TEXT, seq BIGINT NOT NULL, PRIMARY KEY (vault, tx_hash))`,
  `CREATE TABLE IF NOT EXISTS vaults (
  vault TEXT PRIMARY KEY, factory TEXT NOT NULL, owner TEXT, operator TEXT, code_hash TEXT,
  created_block BIGINT NOT NULL, created_tx TEXT NOT NULL, seq BIGINT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS activity (
  seq BIGINT PRIMARY KEY, vault TEXT NOT NULL, agent TEXT, kind TEXT NOT NULL, event TEXT NOT NULL, target TEXT, amount TEXT,
  token TEXT, reason TEXT, class TEXT, block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, data TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS activity_vault ON activity (vault, seq)`,
  `CREATE TABLE IF NOT EXISTS exposure (
  seq BIGINT PRIMARY KEY, vault TEXT NOT NULL, agent TEXT NOT NULL, target TEXT NOT NULL, token TEXT NOT NULL, amount TEXT NOT NULL,
  total TEXT NOT NULL, class TEXT, block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS exposure_vault ON exposure (vault, seq)`,
  `CREATE TABLE IF NOT EXISTS events (
  seq BIGINT PRIMARY KEY, contract TEXT NOT NULL, event TEXT NOT NULL, block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL,
  tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, data TEXT NOT NULL,
  ref_vault TEXT, ref_target TEXT, ref_attestor TEXT, ref_coverage BIGINT
)`,
  `CREATE INDEX IF NOT EXISTS events_event ON events (event, seq)`,
  `CREATE TABLE IF NOT EXISTS coverages (
  seq BIGINT PRIMARY KEY, pool TEXT NOT NULL, id BIGINT NOT NULL, owner TEXT, vault TEXT, agent TEXT, target TEXT, token TEXT, limit_amount TEXT, payout_ratio_bps BIGINT,
  premium_paid TEXT, class TEXT, code_hash TEXT, upgrade_authority TEXT, start_block BIGINT, waiting_period_ends BIGINT, end_block BIGINT, policy_version BIGINT, daily_cap_priced TEXT,
  paid_out TEXT NOT NULL DEFAULT '0', claims_paid BIGINT NOT NULL DEFAULT 0, claims_rejected BIGINT NOT NULL DEFAULT 0, released BIGINT NOT NULL DEFAULT 0,
  block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, UNIQUE (pool, id)
)`,
  `CREATE INDEX IF NOT EXISTS coverages_vault ON coverages (vault, seq)`,
  `CREATE TABLE IF NOT EXISTS claims (
  seq BIGINT PRIMARY KEY, pool TEXT NOT NULL, coverage BIGINT NOT NULL, report BIGINT, outcome TEXT NOT NULL, reason TEXT, payout TEXT, exposure_in_window TEXT,
  exposure_before_change TEXT, exposure_through_last_paid_block TEXT, payout_ratio_bps BIGINT, limit_amount TEXT, paid_before TEXT, to_account TEXT, token TEXT,
  vault TEXT, target TEXT, owner TEXT, block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS claims_coverage ON claims (pool, coverage, seq)`,
  `CREATE TABLE IF NOT EXISTS reports (
  seq BIGINT PRIMARY KEY, registry TEXT NOT NULL, id BIGINT NOT NULL, target TEXT NOT NULL, attestor TEXT, observed_at_block BIGINT, changed_at_block BIGINT, before_ref TEXT, after_ref TEXT,
  before_resolved_hash TEXT, after_resolved_hash TEXT, channel TEXT, nonce BIGINT, expires_at BIGINT, reported_at_block BIGINT NOT NULL, state TEXT NOT NULL, disputed_by BIGINT,
  block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL, UNIQUE (registry, id)
)`,
  `CREATE INDEX IF NOT EXISTS reports_target ON reports (target, seq)`,
  `CREATE TABLE IF NOT EXISTS freezes (
  seq BIGINT PRIMARY KEY, registry TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, report_id BIGINT, from_index BIGINT, to_index BIGINT, frozen_after BIGINT NOT NULL,
  block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS freezes_target ON freezes (registry, target, seq)`,
  `CREATE TABLE IF NOT EXISTS heartbeats (
  seq BIGINT PRIMARY KEY, registry TEXT NOT NULL, attestor TEXT NOT NULL, heartbeat_block BIGINT NOT NULL,
  block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS attestors (
  seq BIGINT PRIMARY KEY, registry TEXT NOT NULL, attestor TEXT NOT NULL, signing_key TEXT, bond TEXT NOT NULL, registered_block BIGINT NOT NULL, last_heartbeat_block BIGINT NOT NULL,
  reports_filed BIGINT NOT NULL DEFAULT 0, slashed TEXT NOT NULL DEFAULT '0', block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL,
  UNIQUE (registry, attestor)
)`,
  `CREATE TABLE IF NOT EXISTS assignments (registry TEXT NOT NULL, target TEXT NOT NULL, attestor TEXT NOT NULL, seq BIGINT NOT NULL, PRIMARY KEY (registry, target))`,
  `CREATE TABLE IF NOT EXISTS classes (
  seq BIGINT PRIMARY KEY, registry TEXT NOT NULL, target TEXT NOT NULL, class TEXT NOT NULL, previous_class TEXT, evidence_hash TEXT, classified_at_block BIGINT, classifier TEXT,
  frozen BIGINT NOT NULL, resolved_code_hash TEXT, upgrade_authority TEXT, block BIGINT NOT NULL, timestamp_ms BIGINT NOT NULL, tx_hash TEXT NOT NULL, receipt_id TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS classes_target ON classes (registry, target, seq)`,
];

/** Every table that is a function of `raw`. Bumping DERIVED_VERSION rebuilds all of them from `raw` on the next open. */
const DERIVED_TABLES = ["creates", "vaults", "activity", "exposure", "events", "coverages", "claims", "reports", "freezes", "heartbeats", "attestors", "assignments", "classes"];
/** 1: vaults, activity, exposure, events. 2: coverages, claims, reports, freezes, heartbeats, attestors, classes. */
const DERIVED_VERSION = 2;

type Filters = Array<[string, unknown]>;

/** Another process moved the cursor first: nothing was written, and the caller reloads its cursor before reading on. */
export class LostRaceError extends Error {
  constructor(readonly first: number, readonly last: number) {
    super(`blocks ${first} to ${last} were not committed: another writer moved the cursor first`);
  }
}

export interface Store {
  /** The last block committed, or null before the first. */
  cursor(): Promise<number | null>;
  /** Commits consecutive blocks, with their records, in one transaction. Throws LostRaceError if another writer got there first. */
  commitBlocks(blocks: Array<{ height: number; records: RawRecord[] }>): Promise<void>;
  commitBlock(height: number, records: RawRecord[]): Promise<void>;
  knownVaults(): Promise<Array<{ vault: string; factory: string }>>;
  setHead(height: number): Promise<void>;
  /** Names the block source now serving blocks, for /health. Kept in memory only. */
  setSource(label: string): void;
  health(head?: number | null): Promise<Health>;
  vaults(q?: VaultsQuery): Promise<Page<VaultSummary>>;
  activity(vault: string, q?: ActivityQuery): Promise<Page<ActivityItem>>;
  exposure(vault: string, q?: ExposureQuery): Promise<Page<ExposureRow>>;
  events(q?: EventsQuery): Promise<Page<EventItem>>;
  coverages(q?: CoveragesQuery): Promise<Page<CoverageItem>>;
  claims(q?: ClaimsQuery): Promise<Page<ClaimItem>>;
  reports(q?: ReportsQuery): Promise<Page<ReportItem>>;
  freezes(q?: FreezesQuery): Promise<Page<FreezeItem>>;
  heartbeats(q?: HeartbeatsQuery): Promise<Page<HeartbeatItem>>;
  attestors(q?: AttestorsQuery): Promise<Page<AttestorItem>>;
  classes(q?: ClassesQuery): Promise<Page<ClassItem>>;
  /** Canonical JSON of every derived table, for comparing two stores (R2). */
  export(): Promise<string>;
  /** Empties every table, raw records and cursor included, so the next run starts again from the start block. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Stable key order, so two stores with the same rows export the same bytes. */
function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical);
  if (typeof x === "object" && x !== null) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical((x as Row)[k])]));
  return x;
}

export async function openStore(db: Db, o: { now?: () => number } = {}): Promise<Store> {
  const now = o.now ?? Date.now;
  let headSeenAt: number | null = null;
  let source: string | undefined;

  await db.transaction(async (tx) => {
    for (const statement of SCHEMA) await tx.run(statement);
  });
  const getMeta = async (k: string, q: Queryable = db) => ((await q.query("SELECT value FROM meta WHERE key = ?", [k]))[0]?.value as string | undefined) ?? null;
  const setMeta = (k: string, v: string, q: Queryable = db) => q.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, v]);
  const cursor = async () => {
    const v = await getMeta("cursor");
    return v === null ? null : Number(v);
  };

  // The derived tables are a function of `raw` (KTD3). A store made before a derived table existed has the
  // raw events but not the table, so when the version moves, every derived table is rebuilt from `raw`,
  // in seq order, in one transaction. A store that is empty just records the version.
  if ((await getMeta("derived_version")) !== String(DERIVED_VERSION)) {
    await db.transaction(async (tx) => {
      for (const t of DERIVED_TABLES) await tx.run(`DELETE FROM ${t}`);
      const rows = await tx.query("SELECT * FROM raw ORDER BY seq");
      for (const r of rows) {
        await applyRecord(tx, Number(r.seq), {
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
      await setMeta("derived_version", String(DERIVED_VERSION), tx);
    });
  }

  /** `extra` is one more condition, with its own arguments, for filters that depend on the cursor (a status the clock decides). */
  async function page<T>(
    table: string,
    filters: Filters,
    q: { after?: number; limit?: number },
    map: (r: Row, last: number) => T | Promise<T>,
    extra?: (last: number) => { sql: string; args: unknown[] },
  ): Promise<Page<T>> {
    const limit = clampLimit(q.limit);
    const last = (await cursor()) ?? 0;
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
      const e = extra(last);
      where.push(e.sql);
      args.push(...e.args);
    }
    const rows = await db.query(`SELECT * FROM ${table} WHERE ${where.join(" AND ")} ORDER BY seq LIMIT ?`, [...args, limit + 1]);
    const more = rows.length > limit;
    const items = await Promise.all(rows.slice(0, limit).map((r) => map(r, last)));
    return { last_indexed_block: last, items, next_after: more ? Number(rows[limit - 1].seq) : null };
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
    const coverageRow = (r: Row, last: number): CoverageItem => {
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
  const reportRow = (r: Row, last: number): ReportItem => {
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
      state: (stored === "pending" && last >= reported + CHALLENGE_WINDOW_BLOCKS ? "verified" : stored) as ReportItem["state"],
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
  const attestorRow = async (r: Row, last: number): Promise<AttestorItem> => {
    const targets = (await db.query("SELECT target FROM assignments WHERE registry = ? AND attestor = ? ORDER BY target", [r.registry as string, r.attestor as string])).map((x) => String(x.target));
    const sinceBeat = Math.max(0, last - Number(r.last_heartbeat_block));
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

  const commitBlocks: Store["commitBlocks"] = async (blocks) => {
    if (blocks.length === 0) return;
    const first = blocks[0].height;
    const last = blocks[blocks.length - 1].height;
    blocks.forEach((b, i) => {
      if (b.height !== first + i) throw new Error(`block ${b.height} does not follow block ${first + i - 1}: a window is consecutive blocks`);
    });
    await db.transaction(async (tx) => {
      // The cursor a window expects is the block before its first. Moving it is the first write: it takes the row lock,
      // so a second writer waits here and then finds the cursor moved. No read of the cursor is needed on the way.
      let moved = await tx.run("UPDATE meta SET value = ? WHERE key = 'cursor' AND value = ?", [String(last), String(first - 1)]);
      if (moved === 0) {
        const current = await getMeta("cursor", tx);
        // An empty store takes any first block; a store whose cursor is before this window has a gap; one whose cursor is
        // at or past its first block has been moved by another writer.
        if (current === null) moved = await tx.run("INSERT INTO meta (key, value) VALUES ('cursor', ?) ON CONFLICT (key) DO NOTHING", [String(last)]);
        else if (Number(current) < first - 1) throw new Error(`block ${first} is not next after cursor ${current}`);
        if (moved === 0) throw new LostRaceError(first, last);
      }
      for (const b of blocks) {
        for (const rec of b.records) {
          const inserted = await tx.query(
            "INSERT INTO raw (kind, contract, name, data, block, timestamp_ms, tx_hash, receipt_id, idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (receipt_id, kind, idx) DO NOTHING RETURNING seq",
            [rec.kind, rec.contract, rec.name, JSON.stringify(rec.data), rec.block, rec.timestamp_ms, rec.tx_hash, rec.receipt_id, rec.idx],
          );
          if (inserted.length === 0) continue;
          await applyRecord(tx, Number(inserted[0].seq), rec);
        }
      }
    });
  };

  return {
    cursor,
    commitBlocks,
    commitBlock: (height, records) => commitBlocks([{ height, records }]),
    knownVaults: async () => (await db.query("SELECT vault, factory FROM vaults ORDER BY seq")).map((r) => ({ vault: String(r.vault), factory: String(r.factory) })),
    async setHead(h) {
      headSeenAt = now();
      if ((await getMeta("head")) !== String(h)) await setMeta("head", String(h));
    },
    setSource(label) {
      source = label;
    },
    async health(head) {
      const last = (await cursor()) ?? 0;
      const stored = await getMeta("head");
      const knownHead = head ?? (stored === null ? null : Number(stored));
      const lag = knownHead === null ? null : Math.max(0, knownHead - last);
      const seenAgo = head !== undefined && head !== null ? 0 : headSeenAt === null ? null : now() - headSeenAt;
      const unparsed = Number((await db.query("SELECT COUNT(*) AS n FROM raw WHERE kind = 'unparsed'"))[0].n);
      const healthy = lag !== null && lag <= HEALTHY_LAG_BLOCKS && seenAgo !== null && seenAgo <= HEAD_STALE_MS;
      const mode = lag === null ? undefined : lag > HEALTHY_LAG_BLOCKS ? ("catching_up" as const) : ("following" as const);
      return { last_indexed_block: last, head_block: knownHead, lag_blocks: lag, head_seen_ms_ago: seenAgo, unparsed_events: unparsed, healthy, ...(source && { source }), ...(mode && { mode }) };
    },
    vaults: (q = {}) => page("vaults", [["owner", q.owner], ["operator", q.operator], ["code_hash", q.code_hash]], q, vaultRow),
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
      const status: Record<string, (L: number) => { sql: string; args: unknown[] }> = {
        released: () => ({ sql: "released = 1", args: [] }),
        waiting: (L) => ({ sql: "released = 0 AND ? < waiting_period_ends", args: [L] }),
        active: (L) => ({ sql: "released = 0 AND ? >= waiting_period_ends AND ? <= end_block", args: [L, L] }),
        expired: (L) => ({ sql: "released = 0 AND ? > end_block", args: [L] }),
      };
      return page("coverages", [["pool", q.pool], ["vault", q.vault], ["owner", q.owner], ["agent", q.agent], ["target", q.target], ["token", q.token]], q, coverageRow, q.status ? status[q.status] : undefined);
    },
    claims: (q = {}) => page("claims", [["pool", q.pool], ["vault", q.vault], ["coverage", q.coverage], ["outcome", q.outcome]], q, claimRow),
    reports(q = {}) {
      const state: Record<string, (L: number) => { sql: string; args: unknown[] }> = {
        pending: (L) => ({ sql: "state = 'pending' AND ? < reported_at_block + ?", args: [L, CHALLENGE_WINDOW_BLOCKS] }),
        verified: (L) => ({ sql: "(state = 'verified' OR (state = 'pending' AND ? >= reported_at_block + ?))", args: [L, CHALLENGE_WINDOW_BLOCKS] }),
        disputed: () => ({ sql: "state = 'disputed'", args: [] }),
        rejected: () => ({ sql: "state = 'rejected'", args: [] }),
      };
      return page("reports", [["registry", q.registry], ["target", q.target], ["attestor", q.attestor]], q, reportRow, q.state ? state[q.state] : undefined);
    },
    freezes: (q = {}) => page("freezes", [["registry", q.registry], ["target", q.target]], q, freezeRow),
    async heartbeats(q = {}) {
      // "Per target" means the attestor assigned to it now.
      const assigned =
        q.target === undefined
          ? undefined
          : (await db.query("SELECT attestor FROM assignments WHERE target = ?" + (q.registry ? " AND registry = ?" : ""), q.registry ? [q.target, q.registry] : [q.target])).map((x) => String(x.attestor));
      const attestor = q.attestor !== undefined && assigned !== undefined ? assigned.filter((a) => a === q.attestor) : assigned ?? q.attestor;
      return page("heartbeats", [["registry", q.registry], ["attestor", attestor]], q, heartbeatRow);
    },
    attestors: (q = {}) => page("attestors", [["registry", q.registry], ["attestor", q.attestor]], q, attestorRow),
    classes: (q = {}) => page("classes", [["registry", q.registry], ["target", q.target]], q, classRow),
    async export() {
      const last = (await cursor()) ?? 0;
      const all = (sql: string) => db.query(sql);
      const rows = async <T,>(sql: string, map: (r: Row, last: number) => T | Promise<T>) => Promise.all((await all(sql)).map((r) => map(r, last)));
      return JSON.stringify(
        canonical({
          vaults: await rows("SELECT * FROM vaults ORDER BY seq", vaultRow),
          activity: await rows("SELECT * FROM activity ORDER BY seq", activityRow),
          exposure: await rows("SELECT * FROM exposure ORDER BY seq", exposureRow),
          events: await rows("SELECT * FROM events ORDER BY seq", eventRow),
          coverages: await rows("SELECT * FROM coverages ORDER BY seq", coverageRow),
          claims: await rows("SELECT * FROM claims ORDER BY seq", claimRow),
          reports: await rows("SELECT * FROM reports ORDER BY seq", reportRow),
          freezes: await rows("SELECT * FROM freezes ORDER BY seq", freezeRow),
          heartbeats: await rows("SELECT * FROM heartbeats ORDER BY seq", heartbeatRow),
          attestors: await rows("SELECT * FROM attestors ORDER BY seq", attestorRow),
          classes: await rows("SELECT * FROM classes ORDER BY seq", classRow),
          unparsed: await all("SELECT seq, contract, name, data, block, tx_hash FROM raw WHERE kind = 'unparsed' ORDER BY seq"),
        }),
      );
    },
    async reset() {
      await db.run(`TRUNCATE ${["meta", "raw", ...DERIVED_TABLES].join(", ")} RESTART IDENTITY`);
    },
    close: () => db.close(),
  };
}
