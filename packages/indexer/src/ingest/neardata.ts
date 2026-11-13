// Blocks from the NEAR Data archive (testnet.neardata.xyz), which keeps every block. Each block carries every receipt
// outcome with its logs and tx hash. With a FastNear key it is the indexer's archive for the heights below dRPC's window
// (plan 2026-11-13-0431, KTD1); without one it serves about 30 blocks a minute, slower than the chain.

import { sleep } from "../sleep.js";
import type { BlockSource, NeardataBlock } from "./blocks.js";

export const NEARDATA_TESTNET = "https://testnet.neardata.xyz";

/** A rejected key (403) or a bad path does not get better with a retry; a rate limit or a 5xx might. */
const isPermanentClientError = (status: number) => status !== 429 && status < 500;

/**
 * Without a key, neardata serves 30 blocks a minute (measured 11 November 2026), below testnet's block
 * rate, so a real backfill needs `apiKey`: a FastNear key, sent as `Authorization: Bearer`
 * (docs.fastnear.com/neardata). The key is never logged.
 */
export function neardataSource(o: { baseUrl?: string; apiKey?: string; fetch?: typeof globalThis.fetch; retries?: number; backoffMs?: number } = {}): BlockSource {
  const base = (o.baseUrl ?? NEARDATA_TESTNET).replace(/\/+$/, "");
  const doFetch = o.fetch ?? globalThis.fetch.bind(globalThis);
  const retries = o.retries ?? 8;
  const backoff = o.backoffMs ?? 500;
  const headers: Record<string, string> = o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {};
  // The key travels only in the header; nothing that leaves this file may carry it (KTD4).
  const redact = (text: string) => (o.apiKey ? text.split(o.apiKey).join("<key>") : text);
  const scrubbed = (e: unknown) => new Error(redact(e instanceof Error ? e.message : String(e)));

  async function getJson(path: string): Promise<unknown> {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res: Response | undefined;
      try {
        res = await doFetch(`${base}${path}`, { redirect: "follow", headers });
        if (res.ok) return await res.json();
      } catch (e) {
        last = scrubbed(e);
      }
      if (res && !res.ok) {
        await res.body?.cancel();
        last = new Error(`neardata ${path} answered ${res.status}`);
        if (isPermanentClientError(res.status)) throw last;
      }
      if (attempt < retries) await sleep(backoff * 2 ** attempt);
    }
    throw scrubbed(last);
  }

  return {
    async block(height) {
      return (await getJson(`/v0/block/${height}`)) as NeardataBlock | null;
    },
    expand: async (scanned) => scanned,
    async finalHeight() {
      const b = (await getJson("/v0/last_block/final")) as NeardataBlock;
      return b.block.header.height;
    },
  };
}
