import { describe, expect, it } from "vitest";
import { neardataSource } from "../src/ingest/neardata.js";

/** Answers each request with the next of `replies`, recording the URL and headers it saw. */
function scripted(replies: Array<{ status: number; body: unknown }>) {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const block = { block: { header: { height: 5, hash: "h", timestamp_nanosec: "1" } }, shards: [] };

describe("neardata source", () => {
  it("sends the FastNear key as a Bearer header", async () => {
    const { fetch, seen } = scripted([{ status: 200, body: block }]);
    await neardataSource({ fetch, apiKey: "k-123" }).block(5);
    expect(seen).toEqual([{ url: "https://testnet.neardata.xyz/v0/block/5", auth: "Bearer k-123" }]);
  });

  it("sends no Authorization header without a key", async () => {
    const { fetch, seen } = scripted([{ status: 200, body: block }]);
    await neardataSource({ fetch }).block(5);
    expect(seen[0].auth).toBeNull();
  });

  it("retries a rate-limited request and returns the block", async () => {
    const { fetch, seen } = scripted([
      { status: 429, body: { error: "rate-limit exceeded of 30 blocks per minute" } },
      { status: 200, body: block },
    ]);
    expect(await neardataSource({ fetch, backoffMs: 1 }).block(5)).toEqual(block);
    expect(seen).toHaveLength(2);
  });

  it("fails at once on a rejected key instead of retrying", async () => {
    const { fetch, seen } = scripted([{ status: 403, body: { error: "invalid key" } }]);
    await expect(neardataSource({ fetch, apiKey: "bad", backoffMs: 1 }).block(5)).rejects.toThrow(/403/);
    expect(seen).toHaveLength(1);
  });

  it("returns null for a height the chain skipped", async () => {
    const { fetch } = scripted([{ status: 200, body: null }]);
    expect(await neardataSource({ fetch }).block(6)).toBeNull();
  });
});
