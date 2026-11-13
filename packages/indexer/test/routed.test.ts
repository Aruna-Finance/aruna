import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runIndexer } from "../src/indexer.js";
import type { BlockSource } from "../src/ingest/blocks.js";
import { routedSource, type Lane } from "../src/ingest/routed.js";
import { rpcSource, type RpcScan } from "../src/ingest/rpc.js";
import { FIRST, LAST, memorySource, recordedBlocks, SEEDS, testStore } from "./helpers.js";

type Fake = BlockSource<RpcScan> & { calls: number[]; earliestHeight(): Promise<number>; inFlight: number; maxInFlight: number };

/** An endpoint whose blocks touch nothing. `fail` decides per height whether a read throws. */
function fake(o: { earliest?: number; head?: number; fail?: (h: number) => boolean; delayMs?: number } = {}): Fake {
  const f: Fake = {
    calls: [],
    inFlight: 0,
    maxInFlight: 0,
    async block(h) {
      f.calls.push(h);
      f.inFlight++;
      f.maxInFlight = Math.max(f.maxInFlight, f.inFlight);
      try {
        await new Promise((r) => setTimeout(r, o.delayMs ?? 0));
        if (o.fail?.(h)) throw new Error(`answered HTTP 429 at ${h}`);
        return { height: h, touched: [] };
      } finally {
        f.inFlight--;
      }
    },
    expand: async (s) => ({ block: { header: { height: s.height, hash: "", timestamp_nanosec: "0" } }, shards: [] }),
    finalHeight: async () => o.head ?? 1_010,
    earliestHeight: async () => o.earliest ?? 1_000,
  };
  return f;
}

const laneOf = (source: Fake, label: string, concurrency = 8): Lane<RpcScan> & { source: Fake } => ({ source, label, concurrency });

async function readAll(src: BlockSource<unknown>, from: number, to: number) {
  for (let h = from; h <= to; h++) {
    const s = await src.block(h);
    if (s) await src.expand(s, () => false);
  }
}

describe("which endpoint reads a height", () => {
  it("reads heights below the live node's edge from the archive and the rest from live, then never calls the archive again", async () => {
    const archive = fake();
    const live = fake({ earliest: 1_000 });
    const fallback = fake();
    const src = routedSource({ archive: laneOf(archive, "QuickNode"), live: laneOf(live, "dRPC"), fallback: laneOf(fallback, "NEAR archival"), edgeMarginBlocks: 0 });
    await readAll(src, 990, 1_010);
    expect(archive.calls).toEqual(Array.from({ length: 10 }, (_, i) => 990 + i));
    expect(live.calls).toEqual(Array.from({ length: 11 }, (_, i) => 1_000 + i));
    expect(fallback.calls).toEqual([]);
    expect(src.state().source).toBe("dRPC");
  });

  it("does not go back to the archive when a refreshed edge moves above the cursor", async () => {
    let t = 0;
    let earliest = 1_000;
    const archive = fake();
    const live = fake();
    live.earliestHeight = async () => earliest;
    const src = routedSource({ archive: laneOf(archive, "QuickNode"), live: laneOf(live, "dRPC"), fallback: laneOf(fake(), "NEAR archival"), edgeMarginBlocks: 0, edgeRefreshMs: 10, now: () => t });
    await readAll(src, 1_000, 1_002);
    earliest = 5_000;
    t = 100;
    await readAll(src, 1_003, 1_005);
    expect(archive.calls).toEqual([]);
  });

  it("reads heights below the edge from the fallback when no archive is configured", async () => {
    const fallback = fake();
    const src = routedSource({ live: laneOf(fake({ earliest: 1_000 }), "dRPC"), fallback: laneOf(fallback, "NEAR archival"), edgeMarginBlocks: 0 });
    await readAll(src, 998, 999);
    expect(fallback.calls).toEqual([998, 999]);
  });

  it("keeps the margin above the live node's earliest block on the archive", async () => {
    const archive = fake();
    const src = routedSource({ archive: laneOf(archive, "QuickNode"), live: laneOf(fake({ earliest: 1_000 }), "dRPC"), fallback: laneOf(fake(), "NEAR archival"), edgeMarginBlocks: 5 });
    await readAll(src, 1_003, 1_004);
    expect(archive.calls).toEqual([1_003, 1_004]);
  });
});

describe("a failing endpoint", () => {
  it("is benched: the read moves to the fallback, which /health names, and the endpoint is tried again after 5 minutes", async () => {
    let t = 0;
    const archive = fake({ fail: () => true });
    const fallback = fake();
    const src = routedSource({ archive: laneOf(archive, "QuickNode"), live: laneOf(fake({ earliest: 10_000 }), "dRPC"), fallback: laneOf(fallback, "NEAR archival"), now: () => t });
    await readAll(src, 100, 102);
    expect(archive.calls).toEqual([100]);
    expect(fallback.calls).toEqual([100, 101, 102]);
    expect(src.state().source).toBe("NEAR archival");
    t = 5 * 60_000 + 1;
    await readAll(src, 103, 103);
    expect(archive.calls).toEqual([100, 103]);
  });

  it("moves a read live cannot serve to the fallback and benches live", async () => {
    const live = fake({ earliest: 1_000, fail: (h) => h === 1_001 });
    const fallback = fake();
    const src = routedSource({ live: laneOf(live, "dRPC"), fallback: laneOf(fallback, "NEAR archival"), edgeMarginBlocks: 0 });
    await readAll(src, 1_000, 1_003);
    expect(live.calls).toEqual([1_000, 1_001]);
    expect(fallback.calls).toEqual([1_001, 1_002, 1_003]);
  });

  it("fails the read when the fallback fails too", async () => {
    const src = routedSource({ live: laneOf(fake({ earliest: 0, fail: () => true }), "dRPC"), fallback: laneOf(fake({ fail: () => true }), "NEAR archival"), edgeMarginBlocks: 0 });
    await expect(src.block(5)).rejects.toThrow(/HTTP 429/);
  });

  it("reads the head from the fallback while live is benched", async () => {
    const live = fake({ head: 2_000, fail: () => true });
    live.finalHeight = async () => {
      throw new Error("down");
    };
    const src = routedSource({ live: laneOf(live, "dRPC"), fallback: laneOf(fake({ head: 1_990 }), "NEAR archival") });
    expect(await src.finalHeight()).toBe(1_990);
  });
});

describe("routing and the ingest loop", () => {
  it("never puts more reads in flight on an endpoint than its limit", async () => {
    const live = fake({ earliest: 0, delayMs: 5 });
    const src = routedSource({ live: laneOf(live, "dRPC", 4), fallback: laneOf(fake(), "NEAR archival"), edgeMarginBlocks: 0 });
    await Promise.all(Array.from({ length: 8 }, (_, i) => src.block(100 + i)));
    expect(live.maxInFlight).toBe(4);
  });

  it("commits heights in ascending order when a slow archive and a fast live node serve one window", async () => {
    const store = await testStore();
    const committed: number[] = [];
    const commit = store.commitBlocks.bind(store);
    store.commitBlocks = async (blocks) => {
      committed.push(...blocks.map((b) => b.height));
      await commit(blocks);
    };
    const src = routedSource({
      archive: laneOf(fake({ delayMs: 20 }), "QuickNode"),
      live: laneOf(fake({ earliest: 1_004 }), "dRPC"),
      fallback: laneOf(fake(), "NEAR archival"),
      edgeMarginBlocks: 0,
    });
    await runIndexer({ store, source: src, seeds: SEEDS, startBlock: 1_000, stopAt: 1_007, concurrency: 8 });
    expect(committed).toEqual([1_000, 1_001, 1_002, 1_003, 1_004, 1_005, 1_006, 1_007]);
  });

  it("builds the same store from the recorded window split across two endpoints as from one", async () => {
    const recorded = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "rpc", "recorded.json"), "utf8")) as Record<string, unknown>;
    const replayFetch = (async (_url: string | URL, init?: RequestInit) => {
      const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown };
      const hit = recorded[`${method}|${JSON.stringify(params)}`];
      if (hit) return new Response(JSON.stringify(hit), { status: 200 });
      if (method === "EXPERIMENTAL_changes_in_block") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { changes: [] } }), { status: 200 });
      throw new Error(`no recording for ${method}`);
    }) as typeof globalThis.fetch;
    const endpoint = (u: string) => rpcSource({ url: u, fetch: replayFetch, backoffMs: 1 });
    const run = async (source: BlockSource<unknown>) => {
      const store = await testStore();
      await runIndexer({ store, source, seeds: SEEDS, startBlock: FIRST, stopAt: LAST, concurrency: 8 });
      return await store.export();
    };

    const live = endpoint("https://live.example/rpc");
    const edge = 277069000;
    const split = routedSource({
      archive: { source: endpoint("https://archive.example/abcdef1234567890/"), label: "QuickNode", concurrency: 8 },
      live: { source: Object.assign(live, { earliestHeight: async () => edge }), label: "dRPC", concurrency: 4 },
      fallback: { source: endpoint("https://fallback.example/rpc"), label: "NEAR archival", concurrency: 1 },
      edgeMarginBlocks: 0,
    });
    expect(await run(split)).toBe(await run(endpoint("https://single.example/rpc")));
  });
});

describe("neardata as the archive, with QuickNode as its backup (plan 2026-11-13-0431)", () => {
  it("reads below the edge from the backup when the archive fails, and never calls the backup at or above the edge", async () => {
    const archive = fake({ fail: () => true });
    const backup = fake();
    const fallback = fake();
    const src = routedSource({ archive: laneOf(archive, "neardata"), archiveBackup: laneOf(backup, "QuickNode"), live: laneOf(fake({ earliest: 1_000 }), "dRPC"), fallback: laneOf(fallback, "NEAR archival"), edgeMarginBlocks: 0 });
    await readAll(src, 995, 1_005);
    expect(archive.calls).toEqual([995]);
    expect(backup.calls).toEqual([995, 996, 997, 998, 999]);
    expect(fallback.calls).toEqual([]);
  });

  it("goes to the fallback below the edge when the backup fails too", async () => {
    const fallback = fake();
    const src = routedSource({
      archive: laneOf(fake({ fail: () => true }), "neardata"),
      archiveBackup: laneOf(fake({ fail: () => true }), "QuickNode"),
      live: laneOf(fake({ earliest: 1_000 }), "dRPC"),
      fallback: laneOf(fallback, "NEAR archival"),
      edgeMarginBlocks: 0,
    });
    await readAll(src, 998, 999);
    expect(fallback.calls).toEqual([998, 999]);
    expect(src.state().source).toBe("NEAR archival");
  });

  const recorded = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "rpc", "recorded.json"), "utf8")) as Record<string, unknown>;
  const replayFetch = (async (_url: string | URL, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown };
    const hit = recorded[`${method}|${JSON.stringify(params)}`];
    if (hit) return new Response(JSON.stringify(hit), { status: 200 });
    if (method === "EXPERIMENTAL_changes_in_block") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { changes: [] } }), { status: 200 });
    throw new Error(`no recording for ${method}`);
  }) as typeof globalThis.fetch;
  const rpc = (u: string) => rpcSource({ url: u, fetch: replayFetch, backoffMs: 1 });
  const baseline = readFileSync(join(import.meta.dirname, "fixtures", "baseline", "recorded-window.json"), "utf8").trimEnd();
  const edge = 277068800;

  async function exportThrough(archive: BlockSource<unknown>) {
    const live = rpc("https://live.example/rpc");
    const src = routedSource<unknown>({
      archive: { source: archive, label: "neardata", concurrency: 8 },
      live: { source: Object.assign(live, { earliestHeight: async () => edge }) as BlockSource<unknown> & { earliestHeight(): Promise<number> }, label: "dRPC", concurrency: 4 },
      fallback: { source: rpc("https://fallback.example/rpc") as BlockSource<unknown>, label: "NEAR archival", concurrency: 1 },
      edgeMarginBlocks: 0,
    });
    const store = await testStore();
    await runIndexer({ store, source: src, seeds: SEEDS, startBlock: FIRST, stopAt: LAST, concurrency: 8 });
    return store.export();
  }

  it("builds the baseline store from neardata blocks below the edge and RPC scans above it", async () => {
    expect(await exportThrough(memorySource(recordedBlocks()) as BlockSource<unknown>)).toBe(baseline);
  });

  it("re-reads a height from the fallback, instead of handing it a neardata block, when neardata fails in the middle of a window", async () => {
    const inner = memorySource(recordedBlocks());
    let failed = false;
    const flaky: BlockSource<unknown> = {
      ...inner,
      async block(h) {
        if (!failed && h === FIRST + 5) {
          failed = true;
          throw new Error("neardata answered 503");
        }
        return inner.block(h);
      },
    } as BlockSource<unknown>;
    expect(await exportThrough(flaky)).toBe(baseline);
    expect(failed).toBe(true);
  });
});
