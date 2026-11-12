// Regressions for the code review of the indexer (findings #1, #2, #5, #11, #12, #13).
import { describe, expect, it } from "vitest";
import { handle } from "../src/routes.js";
import { runIndexer } from "../src/indexer.js";
import { extractRecords } from "../src/ingest/parse.js";
import { WatchSet } from "../src/ingest/watch.js";
import { HEAD_STALE_MS } from "../src/store.js";
import { clone, FIRST, LAST, memorySource, recordedBlocks, SEEDS, testStore } from "./helpers.js";

const DEMO2 = "demo2.factory.arunafi.testnet";

describe("health notices a head that stopped refreshing (#1)", () => {
  it("is healthy while the head is fresh and unhealthy once it is older than the bound", async () => {
    let now = 1_000_000;
    const store = await testStore({ now: () => now });
    await store.commitBlock(10, []);
    await store.setHead(10);
    expect(await store.health()).toMatchObject({ lag_blocks: 0, healthy: true });
    now += HEAD_STALE_MS + 1;
    expect(await store.health()).toMatchObject({ lag_blocks: 0, healthy: false });
    await store.setHead(10);
    expect((await store.health()).healthy).toBe(true);
  });
});

describe("a vault's initial operator comes from its own create_vault (#2, #11)", () => {
  it("keeps the real operator when another tx calls create_vault for the same name in between", async () => {
    const blocks = recordedBlocks();
    const rival = clone(blocks.get(277068623)!);
    for (const o of rival.shards.flatMap((s) => s.receipt_execution_outcomes ?? [])) {
      o.tx_hash = "RivalTx";
      o.execution_outcome.id = "RivalReceipt";
      const fc = (o.receipt!.receipt as { Action: { actions: Array<{ FunctionCall: { args: string } }> } }).Action.actions[0].FunctionCall;
      const args = JSON.parse(Buffer.from(fc.args, "base64").toString("utf8"));
      fc.args = Buffer.from(JSON.stringify({ ...args, operator: "attacker.testnet" })).toString("base64");
    }
    rival.block.header.height = 277068624;
    blocks.set(277068624, rival);
    const store = await testStore();
    await runIndexer({ store, source: memorySource(blocks), seeds: SEEDS, startBlock: FIRST, stopAt: LAST });
    expect((await store.vaults({ operator: "demo-company.arunafi.testnet" })).items.map((v) => v.vault)).toEqual([DEMO2]);
    expect((await store.vaults({ operator: "attacker.testnet" })).items).toEqual([]);
  });

  it("keeps every create_vault action of one receipt as its own record", async () => {
    const b = clone(recordedBlocks().get(277068623)!);
    const actions = (b.shards.flatMap((s) => s.receipt_execution_outcomes ?? [])[0].receipt!.receipt as { Action: { actions: unknown[] } }).Action.actions;
    actions.push(clone(actions[0]));
    const recs = extractRecords(b, new WatchSet(SEEDS));
    expect(recs.map((r) => [r.kind, r.idx])).toEqual([
      ["call", -1],
      ["call", -2],
    ]);
  });
});

describe("concurrency must be a positive integer (#5)", () => {
  it("refuses NaN instead of spinning", async () => {
    const store = await testStore();
    await expect(runIndexer({ store, source: memorySource(recordedBlocks()), seeds: SEEDS, startBlock: FIRST, stopAt: LAST, concurrency: Number("auto") })).rejects.toThrow(/concurrency/);
  });
});

describe("an unknown activity kind is a bad query, not an empty page (#12)", () => {
  it("answers 400", async () => {
    const store = await testStore();
    expect((await handle(store, "GET", `/v1/vaults/${DEMO2}/activity?kind=refusal`)).status).toBe(400);
    expect((await handle(store, "GET", `/v1/vaults/${DEMO2}/activity?kind=refused`)).status).toBe(200);
  });
});

describe("a block commits all or nothing (#13)", () => {
  it("rolls back a block whose record fails, leaving cursor and tables unchanged", async () => {
    const store = await testStore();
    await runIndexer({ store, source: memorySource(recordedBlocks()), seeds: SEEDS, startBlock: FIRST, stopAt: LAST });
    const before = await store.export();
    const bad = [
      { kind: "event" as const, contract: DEMO2, name: "class_refreshed", data: { target: "swap.arunafi.testnet" }, block: LAST + 1, timestamp_ms: 1, tx_hash: "t", receipt_id: "r", idx: 0 },
      // A non-string agent breaks the exposure table's NOT NULL agent column.
      { kind: "event" as const, contract: DEMO2, name: "exposure_recorded", data: { agent: 5, target: "swap.arunafi.testnet", amount: "1", total: "1" }, block: LAST + 1, timestamp_ms: 1, tx_hash: "t", receipt_id: "r", idx: 1 },
    ];
    await expect(store.commitBlock(LAST + 1, bad)).rejects.toThrow();
    expect(await store.cursor()).toBe(LAST);
    expect(await store.export()).toBe(before);
  });

  it("refuses a block that is not the next height", async () => {
    const store = await testStore();
    await store.commitBlock(10, []);
    await expect(store.commitBlock(12, [])).rejects.toThrow(/not next/);
  });
});
