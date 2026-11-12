import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { toPositional, type Db, type Queryable } from "../src/db.js";
import type { BlockSource, NeardataBlock } from "../src/ingest/blocks.js";
import { openStore, type Store } from "../src/store.js";

const DIR = join(import.meta.dirname, "fixtures", "blocks");

/** Recorded neardata blocks, trimmed to receipts executed by *.arunafi.testnet (fixtures/README.md). */
export function recordedBlocks(): Map<number, NeardataBlock> {
  const m = new Map<number, NeardataBlock>();
  for (const f of readdirSync(DIR)) if (f.endsWith(".json")) m.set(Number(f.replace(".json", "")), JSON.parse(readFileSync(join(DIR, f), "utf8")));
  return m;
}

export const FIRST = 277068623;
export const LAST = 277069048;

/** A deep copy, so a test can alter a recorded block without touching the others. */
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Answers from `blocks`; any other height in range is an empty block, as most testnet blocks are for us. */
export function memorySource(blocks: Map<number, NeardataBlock>, opts: { head?: number; failAt?: number } = {}): BlockSource & { calls: number[] } {
  const calls: number[] = [];
  let failed = false;
  return {
    calls,
    async block(h) {
      calls.push(h);
      if (opts.failAt === h && !failed) {
        failed = true;
        throw new Error(`simulated crash at ${h}`);
      }
      return blocks.get(h) ?? { block: { header: { height: h, hash: `empty-${h}`, timestamp_nanosec: String(1794314403283356753n + BigInt(h - FIRST) * 1_000_000_000n) } }, shards: [] };
    },
    expand: async (b) => b,
    async finalHeight() {
      return opts.head ?? LAST;
    },
  };
}

export const SEEDS = {
  factories: ["factory.arunafi.testnet", "factory2.arunafi.testnet"],
  contracts: ["registry.arunafi.testnet", "registry2.arunafi.testnet", "pool.arunafi.testnet", "pool2.arunafi.testnet"],
};

/** An EVENT_JSON log line as a contract would write it. */
export const eventLine = (event: string, data: unknown) => `EVENT_JSON:${JSON.stringify({ standard: "aruna", version: "1.0.0", event, data: [data] })}`;

/** One Postgres in this process per test file (booting one takes about a second); each test gets a schema of its own in it. */
let shared: Promise<PGlite> | undefined;
let schemas = 0;

export interface TestDatabase {
  pg: PGlite;
  schema: string;
}

/** A fresh, empty database for one test, with BIGINT read as a number like production does. */
export async function pglite(): Promise<TestDatabase> {
  shared ??= (async () => {
    const pg = new PGlite({ parsers: { 20: (v: string) => Number(v) } });
    await pg.waitReady;
    return pg;
  })();
  const pg = await shared;
  const schema = `t${++schemas}`;
  await pg.exec(`CREATE SCHEMA ${schema}`);
  return { pg, schema };
}

/**
 * The database interface over a test database. Two of these over one test database are two writers on one database:
 * PGlite runs one transaction at a time, and each statement runs in the database's own schema.
 */
export function pgliteDb({ pg, schema }: TestDatabase): Db {
  const wrap = (q: Pick<PGlite, "query">): Queryable => ({
    async query(sql, params) {
      await q.query(`SET search_path TO ${schema}`);
      const p = toPositional(sql, params);
      return (await q.query(p.text, p.values)).rows as Array<Record<string, unknown>>;
    },
    async run(sql, params) {
      await q.query(`SET search_path TO ${schema}`);
      const p = toPositional(sql, params);
      return (await q.query(p.text, p.values)).affectedRows ?? 0;
    },
  });
  return { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))), close: async () => {} };
}

/** A store on a fresh Postgres of its own. */
export async function testStore(o: { now?: () => number } = {}): Promise<Store> {
  return openStore(pgliteDb(await pglite()), o);
}
