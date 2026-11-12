import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runIndexer } from "../src/indexer.js";
import type { BlockSource, NeardataBlock } from "../src/ingest/blocks.js";
import type { RawRecord } from "../src/ingest/parse.js";
import { handle, HEALTH_TIMEOUT_MS } from "../src/routes.js";
import { startServer } from "../src/server.js";
import { LostRaceError, openStore } from "../src/store.js";
import { FIRST, LAST, memorySource, pglite, pgliteDb, recordedBlocks, SEEDS, testStore } from "./helpers.js";

const baseline = readFileSync(new URL("./fixtures/baseline/recorded-window.json", import.meta.url), "utf8").trimEnd();

const event = (block: number, name: string, receipt: string): RawRecord => ({ kind: "event", contract: "x.testnet", name, data: {}, block, timestamp_ms: block, tx_hash: `t${block}`, receipt_id: receipt, idx: 0 });

describe("the Postgres store", () => {
  it("gives the recorded window the rows the SQLite store gave it, byte for byte (R10)", async () => {
    const store = await testStore();
    await runIndexer({ store, source: memorySource(recordedBlocks()), seeds: SEEDS, startBlock: FIRST, stopAt: LAST, concurrency: 8 });
    expect(await store.export()).toBe(baseline);
  });

  it("creates its schema on an empty database, with no cursor yet (R6)", async () => {
    const store = await testStore();
    expect(await store.cursor()).toBeNull();
    expect((await store.vaults()).items).toEqual([]);
  });

  it("commits a window of consecutive blocks in one go and moves the cursor to its last block", async () => {
    const store = await testStore();
    await store.commitBlock(10, []);
    await store.commitBlocks([11, 12, 13].map((h) => ({ height: h, records: [event(h, "ping", `r${h}`)] })));
    expect(await store.cursor()).toBe(13);
    expect((await store.events({ event: "ping" })).items.map((e) => e.block)).toEqual([11, 12, 13]);
  });

  it("refuses a window with a gap, before it writes anything", async () => {
    const store = await testStore();
    await expect(store.commitBlocks([{ height: 5, records: [] }, { height: 7, records: [] }])).rejects.toThrow(/does not follow/);
    expect(await store.cursor()).toBeNull();
  });

  it("empties every table, cursor included, when it is reset", async () => {
    const store = await testStore();
    await store.commitBlock(10, [event(10, "ping", "r10")]);
    await store.reset();
    expect(await store.cursor()).toBeNull();
    expect((await store.events()).items).toEqual([]);
    await store.commitBlock(500, [event(500, "ping", "r500")]);
    expect((await store.events()).items.map((e) => e.seq)).toEqual([1]);
  });
});

describe("two writers on one database, as in a Railway deploy overlap (KTD5)", () => {
  it("lets one commit a window and tells the other it lost, leaving the window's records once", async () => {
    const database = await pglite();
    const a = await openStore(pgliteDb(database));
    const b = await openStore(pgliteDb(database));
    const window = (who: string) => [11, 12, 13].map((h) => ({ height: h, records: [event(h, "ping", `${who}${h}`)] }));
    await a.commitBlock(10, []);
    await a.commitBlocks(window("a"));
    await expect(b.commitBlocks(window("b"))).rejects.toBeInstanceOf(LostRaceError);
    expect((await b.events({ event: "ping" })).items.map((e) => e.receipt_id)).toEqual(["a11", "a12", "a13"]);
    expect(await b.cursor()).toBe(13);
    // The loser goes on from the stored cursor.
    await b.commitBlock(14, []);
    expect(await a.cursor()).toBe(14);
  });

  it("lets exactly one of two writers that start the same window at the same time win, on an empty database", async () => {
    const database = await pglite();
    const a = await openStore(pgliteDb(database));
    const b = await openStore(pgliteDb(database));
    const window = (who: string) => [100, 101].map((h) => ({ height: h, records: [event(h, "ping", `${who}${h}`)] }));
    const results = await Promise.allSettled([a.commitBlocks(window("a")), b.commitBlocks(window("b"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(LostRaceError);
    expect((await a.events({ event: "ping" })).items).toHaveLength(2);
    expect(await a.cursor()).toBe(101);
  });

  it("makes the loser take the winner's position and the vaults the winner found in the blocks it skipped", async () => {
    const database = await pglite();
    const storeA = await openStore(pgliteDb(database));
    const storeB = await openStore(pgliteDb(database));
    const blocks = recordedBlocks();

    // b starts after demo2 is created (block 277068625), so it never sees that block itself. It reads its first window,
    // then waits while a indexes from the start through 277068630.
    let firstRead!: () => void;
    const bStarted = new Promise<void>((resolve) => (firstRead = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inner = memorySource(blocks);
    let waited = false;
    const sourceB: BlockSource = {
      ...inner,
      async block(h) {
        if (!waited) {
          waited = true;
          firstRead();
          await gate;
        }
        return inner.block(h);
      },
    };
    const runB = runIndexer({ store: storeB, source: sourceB, seeds: SEEDS, startBlock: 277068627, stopAt: LAST, concurrency: 8 });
    await bStarted;
    await runIndexer({ store: storeA, source: memorySource(blocks), seeds: SEEDS, startBlock: FIRST, stopAt: 277068630, concurrency: 8 });
    release();
    await runB;

    // Every block was committed once, and b recorded the later events of the vault only a had seen created.
    expect(await storeA.export()).toBe(baseline);
  });
});

describe("a restart", () => {
  it("resumes at the block after the stored cursor, not at the start block (AE1)", async () => {
    const database = await pglite();
    const empty = (h: number): NeardataBlock => ({ block: { header: { height: h, hash: `h${h}`, timestamp_nanosec: "0" } }, shards: [] });
    const read: number[] = [];
    const source: BlockSource = { block: async (h) => (read.push(h), empty(h)), expand: async (b) => b, finalHeight: async () => 1_010 };
    await runIndexer({ store: await openStore(pgliteDb(database)), source, seeds: SEEDS, startBlock: 1_000, stopAt: 1_004, concurrency: 4 });
    expect(read[0]).toBe(1_000);
    read.length = 0;
    // A new process on the same database, as after a redeploy.
    const again = await openStore(pgliteDb(database));
    expect(await again.cursor()).toBe(1_004);
    await runIndexer({ store: again, source, seeds: SEEDS, startBlock: 1_000, stopAt: 1_007, concurrency: 4 });
    expect(read).toEqual([1_005, 1_006, 1_007]);
  });
});

describe("/health when the database is not there (R11)", () => {
  it("answers unhealthy, with nothing the database would supply, while the store is not open yet", async () => {
    const reply = await handle(null, "GET", "/health");
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ healthy: false, last_indexed_block: 0, head_block: null, lag_blocks: null });
  });

  it("answers 503 on every other route until the store is open", async () => {
    expect((await handle(null, "GET", "/v1/vaults")).status).toBe(503);
  });

  it("answers unhealthy when the database errors, and when it does not answer in time", async () => {
    const store = await testStore();
    store.health = async () => {
      throw new Error("connection terminated");
    };
    expect(JSON.parse((await handle(store, "GET", "/health")).body).healthy).toBe(false);
    store.health = () => new Promise(() => {});
    const started = Date.now();
    expect(JSON.parse((await handle(store, "GET", "/health")).body).healthy).toBe(false);
    expect(Date.now() - started).toBeLessThan(HEALTH_TIMEOUT_MS + 3_000);
  });

  it("is served by a server that started before the store existed, then by the store once it is open", async () => {
    let store: Awaited<ReturnType<typeof testStore>> | null = null;
    const { server, close } = await startServer({ store: () => store, port: 0, host: "127.0.0.1" });
    try {
      const port = (server.address() as { port: number }).port;
      const get = async (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
      const before = await get("/health");
      expect(before.status).toBe(200);
      expect(((await before.json()) as { healthy: boolean }).healthy).toBe(false);
      expect((await get("/v1/vaults")).status).toBe(503);
      store = await testStore();
      expect((await get("/v1/vaults")).status).toBe(200);
    } finally {
      await close();
    }
  });
});
