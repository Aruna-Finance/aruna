// Blocks from the public NEAR Data archive (plan KTD1). Each block carries every receipt outcome with
// its logs and tx hash.

import { sleep } from "../sleep.js";

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

/**
 * Where blocks come from, in two phases. `block` is a cheap read that is safe to run in parallel across a window of
 * heights. `expand` then completes one scanned block into receipt outcomes, and runs in height order at commit time,
 * so it sees the watched set as it stands after every earlier block: a vault created a few blocks ago is already in it.
 * A source that reads whole blocks has nothing left to do in `expand`.
 */
export interface BlockSource<Scanned = NeardataBlock> {
  /** The block at `height`, or null when the chain skipped that height. */
  block(height: number): Promise<Scanned | null>;
  /** The scanned block with the receipt outcomes of the accounts `watched` keeps. */
  expand(scanned: Scanned, watched: (account: string) => boolean): Promise<NeardataBlock>;
  /** The latest final block height. */
  finalHeight(): Promise<number>;
}

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

  async function getJson(path: string): Promise<unknown> {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res: Response | undefined;
      try {
        res = await doFetch(`${base}${path}`, { redirect: "follow", headers });
        if (res.ok) return await res.json();
      } catch (e) {
        last = e;
      }
      if (res && !res.ok) {
        await res.body?.cancel();
        last = new Error(`neardata ${path} answered ${res.status}`);
        if (isPermanentClientError(res.status)) throw last;
      }
      if (attempt < retries) await sleep(backoff * 2 ** attempt);
    }
    throw last instanceof Error ? last : new Error(String(last));
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
