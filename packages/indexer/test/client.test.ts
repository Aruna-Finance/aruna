import { describe, expect, it } from "vitest";
import { createIndexerClient, IndexerUnavailableError } from "../src/client.js";
import type { ActivityItem, Page } from "../src/api.js";

const REFUSAL: ActivityItem = {
  seq: 7,
  kind: "refused",
  event: "execution_rejected",
  vault: "demo2.factory.arunafi.testnet",
  agent: "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
  target: "attacker.testnet",
  amount: null,
  token: null,
  reason: "ARUNA_TARGET_NOT_ALLOWED",
  class: null,
  block: 277068990,
  timestamp_ms: 1794314618764,
  tx_hash: "FQG3Ym8DoFPTTstJAzojj6kY2ACnGNgAgryf6A4kweWq",
  receipt_id: "Ds1jd8oUCfnTsRYNxGjDFgCu8BC7SmQu4Gxksv5js43W",
  data: { agent: "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi", target: "attacker.testnet", reason: "ARUNA_TARGET_NOT_ALLOWED", class: null, block: 277068990 },
};

/** A fetch that records the URL it was asked for and answers with `body` and `status`. */
function stubFetch(body: unknown, status = 200) {
  const seen: string[] = [];
  const fetch = (async (url: string | URL) => {
    seen.push(String(url));
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

describe("indexer client", () => {
  it("builds the activity URL with its query and parses the page", async () => {
    const page: Page<ActivityItem> = { last_indexed_block: 277069100, items: [REFUSAL], next_after: null };
    const { fetch, seen } = stubFetch(page);
    const client = createIndexerClient({ baseUrl: "https://indexer.example/", fetch });
    const got = await client.activity("demo2.factory.arunafi.testnet", { agent: REFUSAL.agent!, kind: "refused", after: 3, limit: 50 });
    expect(seen).toEqual([
      "https://indexer.example/v1/vaults/demo2.factory.arunafi.testnet/activity?agent=ed25519%3A3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi&kind=refused&after=3&limit=50",
    ]);
    expect(got).toEqual(page);
  });

  it("omits unset query parameters and encodes the vault id", async () => {
    const { fetch, seen } = stubFetch({ last_indexed_block: 1, items: [], next_after: null });
    const client = createIndexerClient({ baseUrl: "https://indexer.example", fetch });
    await client.vaults({ operator: "demo-company.arunafi.testnet" });
    await client.exposure("a/b.testnet", {});
    await client.events({ event: "coverage_purchased,claim_paid", coverage: 2 });
    expect(seen).toEqual([
      "https://indexer.example/v1/vaults?operator=demo-company.arunafi.testnet",
      "https://indexer.example/v1/vaults/a%2Fb.testnet/exposure",
      "https://indexer.example/v1/events?event=coverage_purchased%2Cclaim_paid&coverage=2",
    ]);
  });

  it("rejects a response without last_indexed_block as malformed, not as data", async () => {
    const { fetch } = stubFetch({ items: [REFUSAL], next_after: null });
    const client = createIndexerClient({ baseUrl: "https://indexer.example", fetch });
    const err = await client.activity("demo2.factory.arunafi.testnet").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IndexerUnavailableError);
    expect((err as IndexerUnavailableError).reason).toBe("malformed");
  });

  it("rejects a non-JSON body as malformed", async () => {
    const { fetch } = stubFetch("<html>gateway</html>");
    const err = await createIndexerClient({ baseUrl: "https://indexer.example", fetch }).health().catch((e: unknown) => e);
    expect((err as IndexerUnavailableError).reason).toBe("malformed");
  });

  it("turns a non-200 into an unavailable error carrying the status", async () => {
    const { fetch } = stubFetch({ error: "down" }, 503);
    const err = await createIndexerClient({ baseUrl: "https://indexer.example", fetch }).vaults().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IndexerUnavailableError);
    expect((err as IndexerUnavailableError).reason).toBe("http");
    expect((err as IndexerUnavailableError).status).toBe(503);
  });

  it("turns a network failure into an unavailable error, distinct from an empty page", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const err = await createIndexerClient({ baseUrl: "https://indexer.example", fetch }).exposure("demo2.factory.arunafi.testnet").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IndexerUnavailableError);
    expect((err as IndexerUnavailableError).reason).toBe("network");
  });

  it("parses health", async () => {
    const health = { last_indexed_block: 10, head_block: 12, lag_blocks: 2, unparsed_events: 0, healthy: true };
    const { fetch, seen } = stubFetch(health);
    expect(await createIndexerClient({ baseUrl: "https://indexer.example", fetch }).health()).toEqual(health);
    expect(seen).toEqual(["https://indexer.example/health"]);
  });
});
