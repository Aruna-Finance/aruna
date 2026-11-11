// Blocks from the public NEAR Data archive (plan KTD1). Each block carries every receipt outcome with
// its logs and tx hash; no key is needed. Verified on block 277069040 (demo2's class_refreshed).

export interface ReceiptOutcome {
  tx_hash: string | null;
  receipt: {
    predecessor_id?: string;
    receiver_id?: string;
    receipt_id?: string;
    receipt?: { Action?: { actions?: Array<{ FunctionCall?: { method_name: string; args: string } } | string> } } | Record<string, unknown>;
  } | null;
  execution_outcome: {
    id: string;
    block_hash?: string;
    outcome: { executor_id: string; logs: string[]; status: Record<string, unknown> | string };
  };
}

export interface NeardataBlock {
  block: { header: { height: number; hash: string; timestamp_nanosec: string } };
  shards: Array<{ shard_id?: number; receipt_execution_outcomes: ReceiptOutcome[] | null }>;
}

export interface BlockSource {
  /** The block at `height`, or null when the chain skipped that height. */
  block(height: number): Promise<NeardataBlock | null>;
  /** The latest final block height. */
  finalHeight(): Promise<number>;
}

export const NEARDATA_TESTNET = "https://testnet.neardata.xyz";

export function neardataSource(o: { baseUrl?: string; fetch?: typeof globalThis.fetch; retries?: number; backoffMs?: number } = {}): BlockSource {
  const base = (o.baseUrl ?? NEARDATA_TESTNET).replace(/\/+$/, "");
  const doFetch = o.fetch ?? globalThis.fetch.bind(globalThis);
  const retries = o.retries ?? 8;
  const backoff = o.backoffMs ?? 500;

  async function getJson(path: string): Promise<unknown> {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await doFetch(`${base}${path}`, { redirect: "follow" });
        if (res.ok) return await res.json();
        last = new Error(`neardata ${path} answered ${res.status}`);
        // 4xx other than rate limiting will not get better with a retry.
        if (res.status !== 429 && res.status < 500) throw last;
      } catch (e) {
        last = e;
      }
      if (attempt < retries) await new Promise((r) => setTimeout(r, backoff * 2 ** attempt));
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  return {
    async block(height) {
      return (await getJson(`/v0/block/${height}`)) as NeardataBlock | null;
    },
    async finalHeight() {
      const b = (await getJson("/v0/last_block/final")) as NeardataBlock;
      return b.block.header.height;
    },
  };
}
