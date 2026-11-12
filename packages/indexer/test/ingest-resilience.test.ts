import { describe, expect, it } from "vitest";
import { runIndexer } from "../src/indexer.js";
import type { BlockSource, NeardataBlock } from "../src/ingest/blocks.js";
import { HEALTHY_LAG_BLOCKS } from "../src/store.js";
import { SEEDS, testStore } from "./helpers.js";

const empty = (h: number): NeardataBlock => ({ block: { header: { height: h, hash: `h${h}`, timestamp_nanosec: "0" } }, shards: [] });

/** A source of empty blocks whose head is `head`, or whose head reads fail when `head` is an Error. */
function source(head: number | Error, label = "dRPC"): BlockSource & { reads: number[]; state(): { source: string } } {
  const reads: number[] = [];
  return {
    reads,
    async block(h) {
      reads.push(h);
      return empty(h);
    },
    expand: async (b) => b,
    async finalHeight() {
      if (head instanceof Error) throw head;
      return head;
    },
    state: () => ({ source: label }),
  };
}

describe("ingest when the head cannot be read", () => {
  it("keeps committing up to the last head it knew, and reports that head as seen long ago", async () => {
    let t = 0;
    const store = await testStore({ now: () => t });
    await runIndexer({ store, source: source(120), seeds: SEEDS, startBlock: 101, stopAt: 100 });
    await store.setHead(120);
    t = 90_000;
    // A restart whose every head read fails: the 20 final blocks it already knew of are still read.
    const failing = source(new Error("block answered HTTP 429"));
    await runIndexer({ store, source: failing, seeds: SEEDS, startBlock: 101 });
    expect(failing.reads).toEqual(Array.from({ length: 20 }, (_, i) => 101 + i));
    expect(await store.cursor()).toBe(120);
    expect((await store.health()).head_seen_ms_ago).toBe(90_000);
  });

  it("fails as before when it has never known a head", async () => {
    const store = await testStore();
    await expect(runIndexer({ store, source: source(new Error("down")), seeds: SEEDS, startBlock: 101 })).rejects.toThrow("down");
  });

  it("resumes after the committed cursor and reads no committed block again", async () => {
    const store = await testStore();
    await runIndexer({ store, source: source(105), seeds: SEEDS, startBlock: 101 });
    const again = source(108);
    await runIndexer({ store, source: again, seeds: SEEDS, startBlock: 101 });
    expect(again.reads).toEqual([106, 107, 108]);
  });
});

describe("/health names the source and whether it is catching up", () => {
  it("reports catching_up beyond the healthy lag and following within it, with the source's label", async () => {
    const store = await testStore();
    await runIndexer({ store, source: source(110, "QuickNode"), seeds: SEEDS, startBlock: 101 });
    await store.setHead(110 + HEALTHY_LAG_BLOCKS + 1);
    expect(await store.health()).toMatchObject({ source: "QuickNode", mode: "catching_up" });
    await store.setHead(110 + HEALTHY_LAG_BLOCKS);
    expect(await store.health()).toMatchObject({ source: "QuickNode", mode: "following" });
  });
});
