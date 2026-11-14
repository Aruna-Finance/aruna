import { describe, expect, it } from "vitest";
import { runIndexer } from "../src/indexer.js";
import { FIRST, LAST, memorySource, recordedBlocks, SEEDS, testStore } from "./helpers.js";

const DEMO2 = "demo2.factory.arunafi.testnet";
const AGENT = "ed25519:7THAYJHPStMpR3xZjiKoHDdBu6ChQWfG6w93r9sUxHFi";
const TARGET = "swap.arunafi.testnet";

const exposure = (block: number, idx: number, amount: string, total: string, cls: string) => ({
  kind: "event" as const,
  contract: DEMO2,
  name: "exposure_recorded",
  data: { agent: AGENT, target: TARGET, amount, total, class: cls, token: "near" },
  block,
  timestamp_ms: block,
  tx_hash: `tx${block}`,
  receipt_id: `r${block}`,
  idx,
});

// Acceptance: "each exposure row carries the class at the time it was recorded".
// The vault's own `Exposure.class_at_record` is overwritten on every record (AUDIT-v0 I1), so the
// history has to come from the append-only `exposure_recorded` events. This pins that behaviour.
describe("exposure rows keep the class each one was recorded under", () => {
  it("does not overwrite an earlier row's class when the target's class changes", async () => {
    const store = await testStore();
    await runIndexer({ store, source: memorySource(recordedBlocks()), seeds: SEEDS, startBlock: FIRST, stopAt: LAST });
    const recorded = (await store.exposure(DEMO2, {})).items.length;

    await store.commitBlock(LAST + 1, [exposure(LAST + 1, 0, "1", "300", "immutable_verified")]);
    await store.commitBlock(LAST + 2, [exposure(LAST + 2, 0, "2", "302", "global_by_account")]);

    const rows = (await store.exposure(DEMO2, { target: TARGET })).items;
    expect(rows).toHaveLength(recorded + 2);
    expect(rows.slice(-3).map((r) => r.class)).toEqual(["local_upgradeable", "immutable_verified", "global_by_account"]);
    expect(rows.slice(-2).map((r) => r.block)).toEqual([LAST + 1, LAST + 2]);
  });

  it("stores null, never a guess, when an event carries no class", async () => {
    const store = await testStore();
    await runIndexer({ store, source: memorySource(recordedBlocks()), seeds: SEEDS, startBlock: FIRST, stopAt: LAST });
    const rec = exposure(LAST + 1, 0, "1", "301", "x");
    delete (rec.data as { class?: string }).class;
    await store.commitBlock(LAST + 1, [rec]);
    expect((await store.exposure(DEMO2, {})).items.at(-1)?.class).toBeNull();
  });
});
