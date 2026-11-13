// One block source over three RPC endpoints (plan U2, KTD1-KTD5):
//
//   archive   optional (neardata with a FastNear key, or a QuickNode trial). Reads only the heights the live node no
//             longer holds. It may have a backup (QuickNode behind neardata) that reads what it fails to serve.
//   live      free, prunes old blocks (dRPC). Reads everything from its lower edge on, and the head.
//   fallback  free, archival, slow (NEAR's archival RPC). Reads whatever the other two cannot.
//
// The router only chooses which endpoint answers a call. The endpoints' scans differ (a neardata block, an RPC scan), so
// a scan is only ever expanded by the endpoint that scanned it: when that endpoint fails, the height is read again from
// the next one (plan 2026-11-13-0431, KTD3). Every endpoint gives the same records for a block. Commit order stays with
// runIndexer.

import type { BlockSource, NeardataBlock } from "./blocks.js";

export interface Lane<S> {
  source: BlockSource<S>;
  /** Names the endpoint in logs and /health. Never the URL: a paid endpoint's URL carries its token. */
  label: string;
  /** Calls in flight at once on this endpoint. */
  concurrency: number;
}

export interface RoutedSourceOptions<S> {
  archive?: Lane<S>;
  /** Reads, below the edge, what the archive fails to serve, before the fallback does. Never called at or above the edge. */
  archiveBackup?: Lane<S>;
  live: Lane<S> & { source: BlockSource<S> & { earliestHeight(): Promise<number> } };
  fallback: Lane<S>;
  /** Heights below the live node's earliest block plus this many are read from the archive (KTD1). */
  edgeMarginBlocks?: number;
  /** How long a known edge is trusted before the live node is asked again. */
  edgeRefreshMs?: number;
  /** How long a failing endpoint is skipped before it is tried again (KTD3). */
  benchMs?: number;
  now?: () => number;
  /** Called with a lane's label when it becomes the one serving blocks. */
  onSwitch?: (label: string) => void;
}

export interface RoutedSource<S> extends BlockSource<Routed<S>> {
  /** The label of the endpoint that served the latest block. */
  state(): { source: string };
}

/** A scanned block, and the endpoint that scanned it, so `expand` asks the same one. */
export interface Routed<S> {
  lane: InternalLane<S>;
  scan: S;
  height: number;
}

interface InternalLane<S> extends Lane<S> {
  benchedUntil: number;
  active: number;
  queue: Array<() => void>;
}

function lane<S>(l: Lane<S>): InternalLane<S> {
  return { ...l, benchedUntil: 0, active: 0, queue: [] };
}

/** Runs `fn` once a slot on `l` is free. */
async function limited<S, T>(l: InternalLane<S>, fn: () => Promise<T>): Promise<T> {
  if (l.active >= l.concurrency) await new Promise<void>((resolve) => l.queue.push(resolve));
  l.active++;
  try {
    return await fn();
  } finally {
    l.active--;
    l.queue.shift()?.();
  }
}

export function routedSource<S>(o: RoutedSourceOptions<S>): RoutedSource<S> {
  const archive = o.archive ? lane(o.archive) : undefined;
  const archiveBackup = archive && o.archiveBackup ? lane(o.archiveBackup) : undefined;
  const live = lane(o.live);
  const fallback = lane(o.fallback);
  const margin = o.edgeMarginBlocks ?? 2_000;
  const refreshMs = o.edgeRefreshMs ?? 600_000;
  const benchMs = o.benchMs ?? 300_000;
  const now = o.now ?? Date.now;

  let edge: { height: number; at: number } | undefined;
  // Set once a height at or above the edge is routed: from then on the archive is never called (KTD4).
  let latched = false;
  let serving: string | undefined;

  const benched = (l: InternalLane<S>) => l.benchedUntil > now();

  async function currentEdge(): Promise<number> {
    if (edge && now() - edge.at < refreshMs) return edge.height;
    try {
      edge = { height: (await o.live.source.earliestHeight()) + margin, at: now() };
    } catch {
      // Unknown edge: keep the last one, or send everything to an archival endpoint, which holds every height.
      if (!edge) return Number.POSITIVE_INFINITY;
    }
    return edge.height;
  }

  /** The endpoints that may answer for `height`, in order; a benched one is skipped, and the fallback is always last. */
  async function lanesFor(height: number): Promise<Array<InternalLane<S>>> {
    if (!latched && height < (await currentEdge())) return [...[archive, archiveBackup].filter((l): l is InternalLane<S> => !!l && !benched(l)), fallback];
    latched = true;
    return benched(live) ? [fallback] : [live, fallback];
  }

  /** The endpoints that come after `l` when it fails, for a height it served. */
  function after(l: InternalLane<S>): Array<InternalLane<S>> {
    if (l === fallback) return [];
    const rest = l === archive && archiveBackup ? [archiveBackup] : [];
    return [...rest.filter((x) => !benched(x)), fallback];
  }

  function bench(l: InternalLane<S>, e: unknown, next: InternalLane<S>) {
    l.benchedUntil = now() + benchMs;
    console.error(`${l.label} failed (${e instanceof Error ? e.message : String(e)}); using ${next.label} for ${Math.round(benchMs / 60_000)} min`);
  }

  /** Runs `call` on the first of `lanes`; if it fails there, benches that endpoint and runs it on the next (KTD3). */
  async function withFailover<T>(lanes: Array<InternalLane<S>>, call: (l: InternalLane<S>) => Promise<T>): Promise<{ value: T; lane: InternalLane<S> }> {
    for (let i = 0; ; i++) {
      const l = lanes[i];
      try {
        return { value: await limited(l, () => call(l)), lane: l };
      } catch (e) {
        if (i === lanes.length - 1) throw e;
        bench(l, e, lanes[i + 1]);
      }
    }
  }

  function served(l: InternalLane<S>) {
    if (serving === l.label) return;
    serving = l.label;
    o.onSwitch?.(l.label);
  }

  return {
    async block(height) {
      const { value, lane: l } = await withFailover(await lanesFor(height), (x) => x.source.block(height));
      served(l);
      return value === null ? null : { lane: l, scan: value, height };
    },

    async expand(scanned, watched): Promise<NeardataBlock> {
      const first = scanned.lane;
      if (!benched(first)) {
        try {
          return await limited(first, () => first.source.expand(scanned.scan, watched));
        } catch (e) {
          if (first === fallback) throw e;
          bench(first, e, after(first)[0]);
        }
      }
      // The scan belongs to an endpoint that has failed: read the height again, whole, from the next one.
      const lanes = after(first);
      const { value, lane: l } = await withFailover(lanes, async (x) => {
        const scan = await x.source.block(scanned.height);
        if (scan === null) throw new Error(`${x.label} reports block ${scanned.height} skipped, which ${first.label} served`);
        return x.source.expand(scan, watched);
      });
      served(l);
      return value;
    },

    async finalHeight() {
      const { value } = await withFailover(benched(live) ? [fallback] : [live, fallback], (x) => x.source.finalHeight());
      return value;
    },

    state: () => ({ source: serving ?? (archive ?? live).label }),
  };
}
