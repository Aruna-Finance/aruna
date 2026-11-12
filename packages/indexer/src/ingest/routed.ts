// One block source over three RPC endpoints (plan U2, KTD1-KTD5):
//
//   archive   optional, paid (a QuickNode trial). Reads only the heights the live node no longer holds.
//   live      free, prunes old blocks (dRPC). Reads everything from its lower edge on, and the head.
//   fallback  free, archival, slow (NEAR's archival RPC). Reads whatever the other two cannot.
//
// The router only chooses which endpoint answers a call; every endpoint is an rpcSource, so a block decodes the
// same whichever one served it (R10). Commit order stays with runIndexer.

import type { BlockSource, NeardataBlock } from "./neardata.js";

export interface Lane<S> {
  source: BlockSource<S>;
  /** Names the endpoint in logs and /health. Never the URL: a paid endpoint's URL carries its token. */
  label: string;
  /** Calls in flight at once on this endpoint. */
  concurrency: number;
}

export interface RoutedSourceOptions<S> {
  archive?: Lane<S>;
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

  async function laneFor(height: number): Promise<InternalLane<S>> {
    if (!latched && height < (await currentEdge())) return archive && !benched(archive) ? archive : fallback;
    latched = true;
    return benched(live) ? fallback : live;
  }

  /** Runs `call` on `first`; if it fails there, benches `first` and runs it on the fallback (KTD3). */
  async function withFailover<T>(first: InternalLane<S>, call: (l: InternalLane<S>) => Promise<T>): Promise<{ value: T; lane: InternalLane<S> }> {
    try {
      return { value: await limited(first, () => call(first)), lane: first };
    } catch (e) {
      if (first === fallback) throw e;
      first.benchedUntil = now() + benchMs;
      console.error(`${first.label} failed (${e instanceof Error ? e.message : String(e)}); using ${fallback.label} for ${Math.round(benchMs / 60_000)} min`);
      return { value: await limited(fallback, () => call(fallback)), lane: fallback };
    }
  }

  function served(l: InternalLane<S>) {
    if (serving === l.label) return;
    serving = l.label;
    o.onSwitch?.(l.label);
  }

  return {
    async block(height) {
      const { value, lane: l } = await withFailover(await laneFor(height), (x) => x.source.block(height));
      served(l);
      return value === null ? null : { lane: l, scan: value };
    },

    async expand(scanned, watched): Promise<NeardataBlock> {
      const { value } = await withFailover(benched(scanned.lane) ? fallback : scanned.lane, (x) => x.source.expand(scanned.scan, watched));
      return value;
    },

    async finalHeight() {
      const { value } = await withFailover(benched(live) ? fallback : live, (x) => x.source.finalHeight());
      return value;
    },

    state: () => ({ source: serving ?? (archive ?? live).label }),
  };
}
