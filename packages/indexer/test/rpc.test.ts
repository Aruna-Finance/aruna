import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runIndexer } from "../src/indexer.js";
import { BlockNotServedError, rpcSource } from "../src/ingest/rpc.js";
import { extractRecords, type RawRecord } from "../src/ingest/parse.js";
import { WatchSet } from "../src/ingest/watch.js";
import { openStore } from "../src/store.js";
import { FIRST, LAST, memorySource, recordedBlocks, SEEDS } from "./helpers.js";

const DEMO2 = "demo2.factory.arunafi.testnet";
const URL_ = "https://testnet.quiknode.example/abcdef1234567890token/";
type Reply = { status?: number; body: unknown };
const UNKNOWN_BLOCK = { jsonrpc: "2.0", id: 1, error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_BLOCK" }, code: -32000 } };
const header = (height: number, prev: number) => ({ jsonrpc: "2.0", id: 1, result: { header: { height, prev_height: prev, hash: `h${height}`, timestamp_nanosec: "0" } } });

/** Real testnet responses, recorded from an archival node by rpcSource itself (test/fixtures/rpc/). */
const recorded = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "rpc", "recorded.json"), "utf8")) as Record<string, unknown>;

/** Replays the recording. A block it has no recording for touches no account; any other missing call is a failure. */
function replay(extra: (method: string, params: Record<string, unknown>) => Reply | undefined = () => undefined) {
  const calls: string[] = [];
  const fetch = (async (_url: string | URL, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
    calls.push(method);
    const custom = extra(method, params);
    if (custom) return new Response(JSON.stringify(custom.body), { status: custom.status ?? 200 });
    const hit = recorded[`${method}|${JSON.stringify(params)}`];
    if (hit) return new Response(JSON.stringify(hit), { status: 200 });
    if (method === "EXPERIMENTAL_changes_in_block") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { changes: [] } }), { status: 200 });
    throw new Error(`no recording for ${method} ${JSON.stringify(params)}`);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const view = (r: RawRecord) => JSON.stringify([r.kind, r.contract, r.name, r.data, r.block, r.timestamp_ms, r.tx_hash, r.receipt_id, r.idx]);
const normalized = (records: RawRecord[]) => records.map(view).sort();

function watchSet() {
  const w = new WatchSet(SEEDS);
  w.addVault(DEMO2, "factory.arunafi.testnet");
  return w;
}

describe("rpc source reads the same records as the NEAR Data blocks", () => {
  const neardata = recordedBlocks();
  for (const height of [277068623, 277068625, 277068626, 277069014, 277069040, 277069048]) {
    it(`block ${height}`, async () => {
      const { fetch } = replay();
      const src = rpcSource({ url: URL_, fetch, backoffMs: 1 });
      const w = watchSet();
      const scan = await src.block(height);
      if (!scan) throw new Error("block not found");
      const block = await src.expand(scan, (a) => w.has(a));
      const viaRpc = extractRecords(block, watchSet());
      const viaNeardata = extractRecords(neardata.get(height)!, watchSet());
      expect(viaRpc.length).toBeGreaterThan(0);
      expect(normalized(viaRpc)).toEqual(normalized(viaNeardata));
    });
  }

  it("indexes the recorded window to a store identical to the NEAR Data run, with no event lost", async () => {
    const run = async (source: Parameters<typeof runIndexer>[0]["source"]) => {
      const store = openStore(":memory:");
      await runIndexer({ store, source, seeds: SEEDS, startBlock: FIRST, stopAt: LAST, concurrency: 8 });
      return store;
    };
    const viaRpc = await run(rpcSource({ url: URL_, fetch: replay().fetch, backoffMs: 1 }));
    const viaNeardata = await run(memorySource(recordedBlocks()));
    expect(viaRpc.export()).toBe(viaNeardata.export());
    const exported = JSON.parse(viaRpc.export()) as { exposure: unknown[]; activity: Array<{ kind: string }>; vaults: Array<{ operator: string }> };
    expect(exported.exposure).toHaveLength(1);
    expect(exported.activity.map((a) => a.kind).sort()).toEqual(["auto_disabled", "class_refreshed", "exposure", "refused"]);
    expect(exported.vaults[0].operator).toBe("demo-company.arunafi.testnet");
  });
});

describe("rpc source cost and safety", () => {
  it("makes no call beyond the scan for a block that touches no watched account", async () => {
    const { fetch, calls } = replay();
    const src = rpcSource({ url: URL_, fetch, backoffMs: 1 });
    const scan = await src.block(277068700);
    if (!scan) throw new Error("block not found");
    const block = await src.expand(scan, (a) => watchSet().has(a));
    expect(block.shards).toEqual([]);
    expect(calls).toEqual(["status", "EXPERIMENTAL_changes_in_block"]);
  });

  it("asks for each transaction once when one transaction produced several receipts", async () => {
    const { fetch, calls } = replay();
    const src = rpcSource({ url: URL_, fetch, backoffMs: 1 });
    const w = watchSet();
    for (const h of [277068625, 277068626]) {
      const scan = await src.block(h);
      if (!scan) throw new Error("block not found");
      await src.expand(scan, (a) => w.has(a));
    }
    expect(calls.filter((c) => c === "EXPERIMENTAL_tx_status")).toHaveLength(1);
  });

  it("refuses an endpoint that is not testnet before reading any block", async () => {
    const { fetch, calls } = replay((method) => (method === "status" ? { body: { jsonrpc: "2.0", id: 1, result: { chain_id: "mainnet" } } } : undefined));
    await expect(rpcSource({ url: URL_, fetch }).block(277068623)).rejects.toThrow(/testnet only/);
    expect(calls).toEqual(["status"]);
  });

  it("treats UNKNOWN_BLOCK as a height the chain skipped", async () => {
    const { fetch, calls } = replay((method) => (method === "EXPERIMENTAL_changes_in_block" ? { body: UNKNOWN_BLOCK } : undefined));
    expect(await rpcSource({ url: URL_, fetch }).block(277068700)).toBeNull();
    expect(calls).toEqual(["status", "EXPERIMENTAL_changes_in_block"]);
  });

  it("retries a rate limit and a node timeout, then reads the block", async () => {
    let n = 0;
    const { fetch } = replay((method) => {
      if (method !== "EXPERIMENTAL_changes_in_block") return undefined;
      n++;
      if (n === 1) return { status: 429, body: {} };
      if (n === 2) return { body: { jsonrpc: "2.0", id: 1, error: { name: "HANDLER_ERROR", cause: { name: "TIMEOUT_ERROR" }, code: -32000 } } };
      return undefined;
    });
    const scan = await rpcSource({ url: URL_, fetch, backoffMs: 1 }).block(277068625);
    expect(scan?.touched).toContain("factory.arunafi.testnet");
    expect(n).toBe(3);
  });

  it("fails at once on a rejected token instead of retrying", async () => {
    let n = 0;
    const { fetch } = replay((method) => (method === "EXPERIMENTAL_changes_in_block" ? (n++, { status: 403, body: {} }) : undefined));
    await expect(rpcSource({ url: URL_, fetch, backoffMs: 1 }).block(277068625)).rejects.toThrow(/HTTP 403/);
    expect(n).toBe(1);
  });

  it("explains a value that is only a token, without printing it", () => {
    const token = "abcdef1234567890tokenonly";
    let message = "";
    try {
      rpcSource({ url: token });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/full endpoint URL/);
    expect(message).not.toContain(token);
  });

  it("never lets the endpoint token reach an error message", async () => {
    const fetch = (async () => {
      throw new TypeError(`fetch failed: connect ECONNREFUSED ${URL_} (token abcdef1234567890token)`);
    }) as typeof globalThis.fetch;
    const err = await rpcSource({ url: URL_, fetch, retries: 0 })
      .block(277068625)
      .then(() => new Error("the read did not fail"), (e: unknown) => e as Error);
    expect(err.message).toContain("could not be read");
    expect(err.message).not.toContain("abcdef1234567890token");
    expect(err.message).not.toContain("quiknode");
  });
});

describe("rpc source on a node that prunes old blocks (proveSkips)", () => {
  const H = 277068700;
  const unknownFor = (heights: number[]) => (method: string, params: Record<string, unknown>) =>
    (method === "EXPERIMENTAL_changes_in_block" && heights.includes(params.block_id as number)) || (method === "block" && heights.includes(params.block_id as number)) ? { body: UNKNOWN_BLOCK } : undefined;

  it("returns null for UNKNOWN_BLOCK only when a later block's prev_height shows the height was skipped", async () => {
    const { fetch } = replay((method, params) => (method === "block" && params.block_id === H + 1 ? { body: header(H + 1, H - 1) } : unknownFor([H])(method, params)));
    expect(await rpcSource({ url: URL_, fetch, proveSkips: true }).block(H)).toBeNull();
  });

  it("refuses to call a block skipped when the node holds no later block either", async () => {
    const { fetch } = replay(unknownFor([H, H + 1, H + 2, H + 3]));
    await expect(rpcSource({ url: URL_, fetch, proveSkips: true, backoffMs: 1 }).block(H)).rejects.toBeInstanceOf(BlockNotServedError);
  });

  it("refuses to call a block skipped when a later block names it as its parent", async () => {
    const { fetch } = replay((method, params) => (method === "block" && params.block_id === H + 1 ? { body: header(H + 1, H) } : unknownFor([H])(method, params)));
    await expect(rpcSource({ url: URL_, fetch, proveSkips: true }).block(H)).rejects.toBeInstanceOf(BlockNotServedError);
  });
});

describe("rpc source timeouts and recovery", () => {
  /** Hangs until the request's abort signal fires, as a stalled socket does. */
  const hang = (init?: RequestInit) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));

  it("abandons a hung request after the timeout and retries it", async () => {
    const { fetch: base } = replay();
    let hung = false;
    const fetch = (async (url: string | URL, init?: RequestInit) => {
      if (!hung && String(init?.body).includes("EXPERIMENTAL_changes_in_block")) {
        hung = true;
        return hang(init);
      }
      return base(url, init);
    }) as typeof globalThis.fetch;
    const scan = await rpcSource({ url: URL_, fetch, backoffMs: 1, timeoutMs: 20 }).block(277068625);
    expect(scan?.touched).toContain("factory.arunafi.testnet");
  });

  it("names a timed-out read without the endpoint token", async () => {
    const fetch = (async (_url: string | URL, init?: RequestInit) => hang(init)) as typeof globalThis.fetch;
    const err = await rpcSource({ url: URL_, fetch, retries: 0, timeoutMs: 20 })
      .block(277068625)
      .then(() => new Error("the read did not fail"), (e: unknown) => e as Error);
    expect(err.message).toContain("could not be read");
    expect(err.message).not.toContain("abcdef1234567890token");
  });

  it("checks the network again after a failed status call, so a source can recover", async () => {
    let statusCalls = 0;
    const { fetch } = replay((method) => (method === "status" && ++statusCalls === 1 ? { status: 503, body: {} } : undefined));
    const src = rpcSource({ url: URL_, fetch, retries: 0 });
    await expect(src.block(277068625)).rejects.toThrow(/HTTP 503/);
    const scan = await src.block(277068625);
    expect(scan?.touched).toContain("factory.arunafi.testnet");
  });

  it("keeps refusing an endpoint on another network", async () => {
    const { fetch, calls } = replay((method) => (method === "status" ? { body: { jsonrpc: "2.0", id: 1, result: { chain_id: "mainnet" } } } : undefined));
    const src = rpcSource({ url: URL_, fetch });
    await expect(src.block(277068623)).rejects.toThrow(/testnet only/);
    await expect(src.block(277068623)).rejects.toThrow(/testnet only/);
    expect(calls).toEqual(["status"]);
  });

  it("reads the earliest block the node still holds from status", async () => {
    const { fetch } = replay((method) => (method === "status" ? { body: { jsonrpc: "2.0", id: 1, result: { chain_id: "testnet", sync_info: { earliest_block_height: 277126855 } } } } : undefined));
    expect(await rpcSource({ url: URL_, fetch }).earliestHeight()).toBe(277126855);
  });
});
