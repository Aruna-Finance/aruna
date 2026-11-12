// The same checks as the PGlite suite, on a real Postgres server through postgres.js (the driver production uses), and the
// row lock between two connections that PGlite cannot show. Opt-in: set ARUNA_TEST_DATABASE_URL to a server where this
// test may create databases, e.g. postgresql://postgres@127.0.0.1:5432/postgres. It creates and drops its own databases.
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { connect } from "../src/db.js";
import { runIndexer } from "../src/indexer.js";
import type { RawRecord } from "../src/ingest/parse.js";
import { LostRaceError, openStore } from "../src/store.js";
import { FIRST, LAST, memorySource, recordedBlocks, SEEDS } from "./helpers.js";

const admin = process.env.ARUNA_TEST_DATABASE_URL;
const baseline = (name: string) => readFileSync(new URL(`./fixtures/baseline/${name}.json`, import.meta.url), "utf8").trimEnd();
const event = (block: number, receipt: string): RawRecord => ({ kind: "event", contract: "x.testnet", name: "ping", data: {}, block, timestamp_ms: block, tx_hash: `t${block}`, receipt_id: receipt, idx: 0 });

interface Golden {
  block: number;
  event: string;
  data: Record<string, unknown>;
}
const golden = (name: string): Golden[] => JSON.parse(readFileSync(new URL(`../../../fixtures/golden/${name}`, import.meta.url), "utf8")).events;

describe.skipIf(!admin)("on a real Postgres server", () => {
  const created: string[] = [];
  const url = (name: string) => {
    const u = new URL(admin!);
    u.pathname = `/${name}`;
    return u.toString();
  };
  async function freshDatabase() {
    const name = `aruna_test_${Date.now()}_${created.length}`;
    const root = connect(admin!);
    await root.run(`CREATE DATABASE ${name}`);
    await root.close();
    created.push(name);
    return url(name);
  }
  afterAll(async () => {
    const root = connect(admin!);
    for (const name of created) await root.run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await root.close();
  });

  it("gives the recorded window the rows the SQLite store gave it, byte for byte", async () => {
    const db = connect(await freshDatabase());
    const store = await openStore(db);
    await runIndexer({ store, source: memorySource(recordedBlocks()), seeds: SEEDS, startBlock: FIRST, stopAt: LAST, concurrency: 8 });
    expect(await store.export()).toBe(baseline("recorded-window"));
    await db.close();
  });

  it("gives the registry's and the pool's real events the rows the SQLite store gave them, byte for byte", async () => {
    let n = 0; // the baselines count receipt ids from zero, registry first
    const load = async (contract: string, events: Golden[]) => {
      const store = await openStore(connect(await freshDatabase()));
      const first = events[0].block;
      const heights = Array.from({ length: events[events.length - 1].block - first + 1 }, (_, i) => first + i);
      await store.commitBlocks(
        heights.map((height) => ({
          height,
          records: events
            .filter((e) => e.block === height)
            .map((e): RawRecord => ({ kind: "event", contract, name: e.event, data: e.data, block: e.block, timestamp_ms: e.block * 1000, tx_hash: `tx-${e.block}-${e.event}`, receipt_id: `r${n++}`, idx: 0 })),
        })),
      );
      return store;
    };
    expect(await (await load("registry2.arunafi.testnet", golden("events-registry.json"))).export()).toBe(baseline("golden-registry"));
    expect(await (await load("pool2.arunafi.testnet", golden("events-pool.json"))).export()).toBe(baseline("golden-pool"));
  });

  it("serves every route's query shape: filters, status clocks, pagination and the empty-list guard", async () => {
    const db = connect(await freshDatabase());
    const store = await openStore(db);
    await runIndexer({ store, source: memorySource(recordedBlocks()), seeds: SEEDS, startBlock: FIRST, stopAt: LAST, concurrency: 8 });
    expect((await store.vaults({ operator: "demo-company.arunafi.testnet" })).items).toHaveLength(1);
    expect((await store.events({ limit: 2 })).next_after).not.toBeNull();
    expect((await store.coverages({ status: "active" })).items).toEqual([]);
    expect((await store.reports({ state: "pending" })).items).toEqual([]);
    expect((await store.heartbeats({ target: "t.testnet", attestor: "a.testnet" })).items).toEqual([]);
    expect((await store.health()).unparsed_events).toBe(0);
    await db.close();
  });

  it("lets exactly one of two connections win the same window, and the other reloads the stored cursor", async () => {
    const dbUrl = await freshDatabase();
    const a = connect(dbUrl);
    const b = connect(dbUrl);
    const storeA = await openStore(a);
    const storeB = await openStore(b);
    const window = (who: string) => [100, 101, 102].map((h) => ({ height: h, records: [event(h, `${who}${h}`)] }));
    const results = await Promise.allSettled([storeA.commitBlocks(window("a")), storeB.commitBlocks(window("b"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(LostRaceError);
    expect((await storeA.events({ event: "ping" })).items).toHaveLength(3);
    expect(await storeB.cursor()).toBe(102);
    await a.close();
    await b.close();
  });

  it("rebuilds the derived tables on reset and keeps seq counting from one", async () => {
    const db = connect(await freshDatabase());
    const store = await openStore(db);
    await store.commitBlock(10, [event(10, "r10")]);
    await store.reset();
    await store.commitBlock(20, [event(20, "r20")]);
    expect((await store.events()).items.map((e) => e.seq)).toEqual([1]);
    await db.close();
  });
});
