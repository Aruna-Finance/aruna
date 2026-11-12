import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createIndexerClient } from "../src/client.js";
import { MAX_LIMIT } from "../src/api.js";
import { runIndexer } from "../src/indexer.js";
import { startServer } from "../src/server.js";
import type { Store } from "../src/store.js";
import { eventLine, FIRST, LAST, memorySource, recordedBlocks, SEEDS, testStore } from "./helpers.js";

const DEMO2 = "demo2.factory.arunafi.testnet";
let store: Store;
let close: () => Promise<void>;
let base: string;

beforeAll(async () => {
  store = await testStore();
  await runIndexer({ store, source: memorySource(recordedBlocks()), seeds: SEEDS, startBlock: FIRST, stopAt: LAST });
  // 600 heartbeats in one more block, to check the page-size clamp.
  const logs = Array.from({ length: 600 }, (_, i) => eventLine("heartbeat", { attestor: "attestor-a.arunafi.testnet", block: LAST + 1, n: i }));
  await store.commitBlock(LAST + 1, logs.map((_, idx) => ({ kind: "event", contract: "registry2.arunafi.testnet", name: "heartbeat", data: { attestor: "attestor-a.arunafi.testnet", n: idx }, block: LAST + 1, timestamp_ms: 1, tx_hash: "hb", receipt_id: "hb-receipt", idx })));
  await store.setHead(LAST + 1);
  const s = await startServer({ store, port: 0 });
  close = s.close;
  base = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await close();
  await store.close();
});

describe("indexer read API", () => {
  it("serves activity matching the read contract, with last_indexed_block equal to the cursor", async () => {
    const page = await createIndexerClient({ baseUrl: base }).activity(DEMO2, { kind: "refused" });
    expect(page.last_indexed_block).toBe(await store.cursor());
    expect(page.items.map((a) => a.reason)).toEqual(["ARUNA_TARGET_NOT_ALLOWED"]);
  });

  it("lists vaults by owner and by code hash", async () => {
    const c = createIndexerClient({ baseUrl: base });
    expect((await c.vaults({ owner: "demo-client.arunafi.testnet" })).items.map((v) => v.vault)).toEqual([DEMO2]);
    expect((await c.vaults({ code_hash: "4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam" })).items).toHaveLength(1);
    expect((await c.vaults({ code_hash: "nope" })).items).toEqual([]);
  });

  it("serves exposure rows and filtered events", async () => {
    const c = createIndexerClient({ baseUrl: base });
    expect((await c.exposure(DEMO2, { target: "swap.arunafi.testnet" })).items[0].class).toBe("local_upgradeable");
    expect((await c.events({ contract: "registry.arunafi.testnet", event: "vault_deployed" })).items).toHaveLength(1);
  });

  it("clamps an oversized page to the maximum and points at the next page", async () => {
    const page = await createIndexerClient({ baseUrl: base }).events({ event: "heartbeat", limit: 10_000 });
    expect(page.items).toHaveLength(MAX_LIMIT);
    expect(page.next_after).toBe(page.items[MAX_LIMIT - 1].seq);
    const rest = await createIndexerClient({ baseUrl: base }).events({ event: "heartbeat", after: page.next_after!, limit: 10_000 });
    expect(rest.items).toHaveLength(100);
    expect(rest.next_after).toBeNull();
  });

  it("refuses a POST", async () => {
    const res = await fetch(`${base}/v1/vaults`, { method: "POST", body: "{}" });
    expect(res.status).toBe(405);
  });

  it("answers a browser origin with CORS headers, on GET and on preflight", async () => {
    const get = await fetch(`${base}/health`, { headers: { origin: "https://console.example" } });
    expect(get.headers.get("access-control-allow-origin")).toBe("*");
    const pre = await fetch(`${base}/v1/vaults`, { method: "OPTIONS", headers: { origin: "https://console.example", "access-control-request-method": "GET" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("reports health, and a lag beyond the bound as not healthy", async () => {
    const c = createIndexerClient({ baseUrl: base });
    expect(await c.health()).toMatchObject({ last_indexed_block: LAST + 1, lag_blocks: 0, healthy: true });
    await store.setHead(LAST + 1 + 500);
    expect(await c.health()).toMatchObject({ lag_blocks: 500, healthy: false });
    await store.setHead(LAST + 1);
  });

  it("answers an unknown route or a bad query with an error status, not a page", async () => {
    expect((await fetch(`${base}/v1/nothing`)).status).toBe(404);
    expect((await fetch(`${base}/v1/events?after=abc`)).status).toBe(400);
  });
});
