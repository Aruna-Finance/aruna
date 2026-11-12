// The ingest loop (plan U2). Blocks are fetched in parallel windows and committed strictly in height
// order, because a vault_created in one block decides whose events count in the next. A restart
// resumes from the committed cursor.

import type { BlockSource } from "./ingest/neardata.js";
import { extractRecords } from "./ingest/parse.js";
import { WatchSet, type Seeds } from "./ingest/watch.js";
import { sleep } from "./sleep.js";
import type { Store } from "./store.js";

export interface IndexerOptions {
  store: Store;
  source: BlockSource<unknown>;
  seeds: Seeds;
  /** First block to read on an empty store. */
  startBlock: number;
  /** Stop after this block. Without it, read to the head; with `follow`, keep reading new blocks. */
  stopAt?: number;
  follow?: boolean;
  concurrency?: number;
  pollMs?: number;
  signal?: AbortSignal;
  onProgress?: (p: { block: number; head: number }) => void;
}

/**
 * The chain's final height. If it cannot be read but the store knows a final head above the cursor, that head is
 * used, so the blocks already known to be final are still read (plan R7); /health then shows the head going stale.
 */
async function readHead(o: IndexerOptions, next: number): Promise<number> {
  try {
    const head = await o.source.finalHeight();
    o.store.setHead(head);
    return head;
  } catch (e) {
    const known = o.store.health().head_block;
    if (known !== null && next <= known) {
      console.error(`head read failed (${e instanceof Error ? e.message : String(e)}); reading on to the last known head ${known}`);
      return known;
    }
    throw e;
  }
}

export async function runIndexer(o: IndexerOptions): Promise<void> {
  const concurrency = o.concurrency ?? 16;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`concurrency must be a positive integer, got ${o.concurrency}`);
  const watch = new WatchSet(o.seeds);
  for (const v of o.store.knownVaults()) watch.addVault(v.vault, v.factory);

  let next = (o.store.cursor() ?? o.startBlock - 1) + 1;
  for (;;) {
    if (o.signal?.aborted) return;
    const head = o.stopAt ?? (await readHead(o, next));

    while (next <= head) {
      if (o.signal?.aborted) return;
      const heights = Array.from({ length: Math.min(concurrency, head - next + 1) }, (_, i) => next + i);
      const fetched = await Promise.allSettled(heights.map((h) => o.source.block(h)));
      for (let i = 0; i < heights.length; i++) {
        const r = fetched[i];
        if (r.status === "rejected") throw r.reason;
        const block = r.value === null ? null : await o.source.expand(r.value, (account) => watch.has(account));
        o.store.commitBlock(heights[i], block === null ? [] : extractRecords(block, watch));
        next = heights[i] + 1;
      }
      const state = (o.source as Partial<{ state(): { source: string } }>).state?.();
      if (state) o.store.setSource(state.source);
      o.onProgress?.({ block: next - 1, head });
    }

    if (o.stopAt !== undefined || !o.follow) return;
    await sleep(o.pollMs ?? 1000, o.signal);
  }
}
