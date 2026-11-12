// The ingest loop (plan U2). Blocks are fetched in parallel windows and committed strictly in height
// order, because a vault_created in one block decides whose events count in the next. A window is one
// transaction (plan KTD5). A restart resumes from the committed cursor.

import type { BlockSource } from "./ingest/blocks.js";
import { extractRecords, type RawRecord } from "./ingest/parse.js";
import { WatchSet, type Seeds } from "./ingest/watch.js";
import { sleep } from "./sleep.js";
import { LostRaceError, type Store } from "./store.js";

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
    await o.store.setHead(head);
    return head;
  } catch (e) {
    const known = (await o.store.health()).head_block;
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
  /** The seeds plus every vault the database knows, which is the whole truth about whose events count. */
  const loadWatch = async () => {
    const w = new WatchSet(o.seeds);
    for (const v of await o.store.knownVaults()) w.addVault(v.vault, v.factory);
    return w;
  };
  const nextAfterCursor = async () => ((await o.store.cursor()) ?? o.startBlock - 1) + 1;
  let watch = await loadWatch();

  let next = await nextAfterCursor();
  for (;;) {
    if (o.signal?.aborted) return;
    const head = o.stopAt ?? (await readHead(o, next));

    while (next <= head) {
      if (o.signal?.aborted) return;
      const heights = Array.from({ length: Math.min(concurrency, head - next + 1) }, (_, i) => next + i);
      const fetched = await Promise.allSettled(heights.map((h) => o.source.block(h)));
      // The blocks before a failed one are still committed, so a restart resumes right after them.
      const batch: Array<{ height: number; records: RawRecord[] }> = [];
      let failure: unknown;
      for (let i = 0; i < heights.length; i++) {
        const r = fetched[i];
        if (r.status === "rejected") {
          failure = r.reason;
          break;
        }
        try {
          const block = r.value === null ? null : await o.source.expand(r.value, (account) => watch.has(account));
          batch.push({ height: heights[i], records: block === null ? [] : extractRecords(block, watch) });
        } catch (e) {
          failure = e;
          break;
        }
      }
      try {
        await o.store.commitBlocks(batch);
      } catch (e) {
        if (!(e instanceof LostRaceError)) throw e;
        // Another writer moved the cursor (a deploy overlap): take its position, and the vaults it found in the blocks we skip.
        watch = await loadWatch();
        next = await nextAfterCursor();
        continue;
      }
      if (batch.length > 0) next = batch[batch.length - 1].height + 1;
      if (failure !== undefined) throw failure;
      const state = (o.source as Partial<{ state(): { source: string } }>).state?.();
      if (state) o.store.setSource(state.source);
      o.onProgress?.({ block: next - 1, head });
    }

    if (o.stopAt !== undefined || !o.follow) return;
    await sleep(o.pollMs ?? 1000, o.signal);
  }
}
