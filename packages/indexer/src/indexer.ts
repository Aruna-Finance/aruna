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
  source: BlockSource;
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

export async function runIndexer(o: IndexerOptions): Promise<void> {
  const concurrency = Math.max(1, o.concurrency ?? 16);
  const watch = new WatchSet(o.seeds);
  for (const v of o.store.knownVaults()) watch.addVault(v.vault, v.factory);

  let next = (o.store.cursor() ?? o.startBlock - 1) + 1;
  for (;;) {
    if (o.signal?.aborted) return;
    const head = o.stopAt ?? (await o.source.finalHeight());
    o.store.setHead(head);

    while (next <= head) {
      if (o.signal?.aborted) return;
      const heights = Array.from({ length: Math.min(concurrency, head - next + 1) }, (_, i) => next + i);
      const fetched = await Promise.allSettled(heights.map((h) => o.source.block(h)));
      for (let i = 0; i < heights.length; i++) {
        const r = fetched[i];
        if (r.status === "rejected") throw r.reason;
        o.store.commitBlock(heights[i], r.value === null ? [] : extractRecords(r.value, watch));
        next = heights[i] + 1;
      }
      o.onProgress?.({ block: next - 1, head });
    }

    if (o.stopAt !== undefined || !o.follow) return;
    await sleep(o.pollMs ?? 1000, o.signal);
  }
}
