// Read-only checks against the real public endpoints. Off by default: ARUNA_LIVE=1 pnpm --filter @aruna/indexer test live
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/cli.js";
import { routedSource } from "../src/ingest/routed.js";
import { rpcSource } from "../src/ingest/rpc.js";

const config = loadConfig();

async function call<T>(url: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await res.json()) as { result?: T; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result as T;
}

describe.skipIf(!process.env.ARUNA_LIVE)("live endpoints (read-only)", () => {
  const live = rpcSource({ url: config.live_rpc, proveSkips: true });

  it("dRPC is on testnet and holds a recent window of blocks", async () => {
    const head = await live.finalHeight();
    const earliest = await live.earliestHeight();
    expect(head - earliest).toBeGreaterThan(0);
    expect(head - earliest).toBeLessThan(300_000);
  }, 30_000);

  it("dRPC answers every method the RPC source uses, for a recent block that touched an account", async () => {
    const head = await live.finalHeight();
    // Walk back from the head to a transaction that executed a receipt.
    for (let h = head - 50; h > head - 200; h--) {
      const block = await call<{ chunks: Array<{ chunk_hash: string; tx_root: string }> }>(config.live_rpc, "block", { block_id: h });
      const chunk = block.chunks.find((c) => c.tx_root !== "11111111111111111111111111111111");
      if (!chunk) continue;
      const { transactions } = await call<{ transactions: Array<{ hash: string; signer_id: string; receiver_id: string }> }>(config.live_rpc, "chunk", { chunk_id: chunk.chunk_hash });
      const tx = transactions[0];
      const status = await call<{ receipts_outcome: Array<{ id: string; block_hash: string }> }>(config.live_rpc, "EXPERIMENTAL_tx_status", { tx_hash: tx.hash, sender_account_id: tx.signer_id, wait_until: "FINAL" });
      const receipt = status.receipts_outcome[0];
      const { header } = await call<{ header: { height: number } }>(config.live_rpc, "block", { block_id: receipt.block_hash });
      await call(config.live_rpc, "EXPERIMENTAL_changes_in_block", { block_id: header.height });
      await call(config.live_rpc, "EXPERIMENTAL_changes", { changes_type: "account_changes", account_ids: [tx.receiver_id], block_id: header.height });
      const back = await call<{ transaction_hash: string }>(config.live_rpc, "EXPERIMENTAL_receipt_to_tx", { receipt_id: receipt.id });
      expect(back.transaction_hash).toBe(tx.hash);
      return;
    }
    throw new Error("no transaction found in the last 200 blocks");
  }, 120_000);

  it("a block near the head scans and expands through the router", async () => {
    const src = routedSource({
      live: { source: live, label: "dRPC", concurrency: 4 },
      fallback: { source: rpcSource({ url: config.fallback_rpc }), label: "NEAR archival", concurrency: 1 },
    });
    const h = (await src.finalHeight()) - 100;
    const scan = await src.block(h);
    if (scan) await src.expand(scan, () => true);
    expect(src.state().source).toBe("dRPC");
  }, 120_000);
});
