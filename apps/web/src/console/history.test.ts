import { IndexerUnavailableError, type ActivityItem, type IndexerClient, type Page } from "@aruna/indexer/client";
import { describe, expect, it, vi } from "vitest";
import { createHistory } from "./history";
import { historyNotice } from "./ui/Freshness";

const item = (seq: number, tx_hash: string): ActivityItem => ({
  seq, block: 100 + seq, timestamp_ms: 0, tx_hash, receipt_id: "r", kind: "allowed", event: "execution_allowed", vault: "v.testnet",
  agent: null, target: null, amount: null, token: null, reason: null, class: null, data: {},
});
const page = (items: ActivityItem[], last: number, next: number | null = null): Page<ActivityItem> => ({ last_indexed_block: last, items, next_after: next });

function client(activity: IndexerClient["activity"]): IndexerClient {
  const nope = async () => {
    throw new Error("not used");
  };
  return { health: nope, vaults: nope, exposure: nope, events: nope, activity } as unknown as IndexerClient;
}

describe("history", () => {
  it("is live with no pending transaction", async () => {
    const h = createHistory({ client: client(async () => page([item(1, "A")], 500)) });
    const r = await h.activity("v.testnet");
    expect(r).toMatchObject({ state: "live", lastIndexedBlock: 500 });
  });

  it("returns unavailable with the last block it saw, not an empty list", async () => {
    let up = true;
    const h = createHistory({
      client: client(async () => {
        if (up) return page([item(1, "A")], 500);
        throw new IndexerUnavailableError("network", "indexer unreachable: fetch failed");
      }),
    });
    await h.activity("v.testnet");
    up = false;
    const r = await h.activity("v.testnet");
    expect(r).toMatchObject({ state: "unavailable", lastKnownBlock: 500 });
    expect(r).not.toHaveProperty("items");
  });

  it("is unavailable with no known block when the indexer was never reached", async () => {
    const h = createHistory({ client: client(async () => Promise.reject(new IndexerUnavailableError("http", "indexer answered 502", 502))) });
    expect(await h.activity("v.testnet")).toMatchObject({ state: "unavailable", lastKnownBlock: null });
  });

  it("does not hide a bug: an unexpected error is thrown, not turned into 'unavailable'", async () => {
    const h = createHistory({ client: client(async () => Promise.reject(new TypeError("bad code"))) });
    await expect(h.activity("v.testnet")).rejects.toThrow("bad code");
  });

  it("is behind while a transaction this tab sent is missing, and keeps it as a pending row", async () => {
    const h = createHistory({ client: client(async () => page([item(1, "A")], 500)) });
    h.track({ hash: "MINE", vault: "v.testnet", label: "Pause agent" });
    const r = await h.activity("v.testnet");
    expect(r.state).toBe("behind");
    expect(r.pending.map((p) => p.hash)).toEqual(["MINE"]);
  });

  it("drops the pending row once the indexer returns the transaction", async () => {
    let seen = false;
    const h = createHistory({ client: client(async () => page(seen ? [item(1, "A"), item(2, "MINE")] : [item(1, "A")], seen ? 502 : 500)) });
    h.track({ hash: "MINE", vault: "v.testnet", label: "Pause agent" });
    expect((await h.activity("v.testnet")).state).toBe("behind");
    seen = true;
    const r = await h.activity("v.testnet");
    expect(r.state).toBe("live");
    expect(h.pending("v.testnet")).toEqual([]);
  });

  it("keeps pending rows per vault", async () => {
    const h = createHistory({ client: client(async () => page([], 500)) });
    h.track({ hash: "X", vault: "other.testnet", label: "x" });
    expect((await h.activity("v.testnet")).state).toBe("live");
    expect(h.pending("other.testnet")).toHaveLength(1);
  });

  it("settle polls until the transaction is indexed, across pages", async () => {
    let calls = 0;
    const activity = vi.fn(async (_v: string, q?: { after?: number }) => {
      calls++;
      if (q?.after === undefined) return page([item(1, "A")], 500, 1);
      return page(calls > 4 ? [item(2, "MINE")] : [], 500 + calls, null);
    });
    const h = createHistory({ client: client(activity as IndexerClient["activity"]) });
    h.track({ hash: "MINE", vault: "v.testnet", label: "x" });
    const r = await h.settle("v.testnet", { intervalMs: 1, sleep: async () => {} });
    expect(r.state).toBe("live");
  });

  it("settle gives up at the deadline and reports behind", async () => {
    let t = 0;
    const h = createHistory({ client: client(async () => page([], 500)), now: () => t });
    h.track({ hash: "MINE", vault: "v.testnet", label: "x" });
    const r = await h.settle("v.testnet", { maxMs: 10, intervalMs: 5, sleep: async () => void (t += 5) });
    expect(r.state).toBe("behind");
  });
});

describe("historyNotice", () => {
  it("says history is unavailable since a block, never an empty state", () => {
    expect(historyNotice({ state: "unavailable", lastKnownBlock: 277069048 }, "live")).toContain("unavailable since block 277,069,048");
    expect(historyNotice({ state: "unavailable", lastKnownBlock: null }, "live")).toContain("could not be reached");
  });
  it("labels recorded sample data as such", () => {
    expect(historyNotice({ state: "live" }, "fixture")).toContain("Recorded sample");
    expect(historyNotice({ state: "live" }, "live")).toBeNull();
  });
  it("counts pending transactions", () => {
    expect(historyNotice({ state: "behind", pending: [{ label: "a" }, { label: "b" }] }, "live")).toContain("2 transactions");
  });
});
