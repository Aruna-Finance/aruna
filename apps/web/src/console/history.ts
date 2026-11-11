import {
  createIndexerClient,
  IndexerUnavailableError,
  type ActivityItem,
  type ActivityQuery,
  type ExposureQuery,
  type ExposureRow,
  type IndexerClient,
  type Page,
  type VaultsQuery,
  type VaultSummary,
} from "@aruna/indexer/client";
import { fixtureIndexerClient } from "./data/indexer-fixture";

// History for the console (plan U4, R10). Every read ends in exactly one of three states, so a screen can always
// tell "nothing happened" from "history is unavailable" from "not indexed yet":
//   live         the indexer answered and every transaction this tab sent is in it
//   behind       the indexer answered, but a transaction this tab sent is not in it yet (kept as a pending row)
//   unavailable  the indexer could not be reached; carries the last block this tab ever saw
// Current state and actions never depend on this file (they go through the SDK), so they work in all three.

export interface PendingTx {
  hash: string;
  vault: string;
  /** What the user did, for the pending row, such as "Pause agent". */
  label: string;
  sentAt: number;
}

export type HistoryState<T> =
  | { state: "live"; items: T[]; lastIndexedBlock: number; next: number | null; pending: PendingTx[] }
  | { state: "behind"; items: T[]; lastIndexedBlock: number; next: number | null; pending: PendingTx[] }
  | { state: "unavailable"; lastKnownBlock: number | null; reason: string; pending: PendingTx[] };

export interface History {
  /** Tell history about a transaction this tab sent, so it shows as pending until the indexer returns it. */
  track(tx: Omit<PendingTx, "sentAt"> & { sentAt?: number }): void;
  pending(vault: string): PendingTx[];
  activity(vault: string, q?: ActivityQuery): Promise<HistoryState<ActivityItem>>;
  exposure(vault: string, q?: ExposureQuery): Promise<HistoryState<ExposureRow>>;
  vaults(q?: VaultsQuery): Promise<HistoryState<VaultSummary>>;
  /** Reads activity until no pending transaction remains for the vault, or the time runs out. */
  settle(vault: string, o?: { intervalMs?: number; maxMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<HistoryState<ActivityItem>>;
  /** "live": the real indexer. "fixture": recorded sample data, shown as such. */
  readonly source: "live" | "fixture";
  readonly lastKnownBlock: () => number | null;
}

const MAX_PAGES = 20;
const byTx = (i: { tx_hash: string }, hash: string) => i.tx_hash === hash;

export function createHistory(o: { client: IndexerClient; source?: "live" | "fixture"; now?: () => number }): History {
  const now = o.now ?? Date.now;
  const pendingTxs = new Map<string, PendingTx>();
  let lastKnown: number | null = null;

  const pending = (vault: string) => [...pendingTxs.values()].filter((p) => p.vault === vault);

  async function read<T>(vault: string | null, hasTx: (item: T, hash: string) => boolean, fetchPage: (after?: number) => Promise<Page<T>>, walk: boolean) {
    try {
      let page = await fetchPage();
      const items = [...page.items];
      lastKnown = page.last_indexed_block;
      // A transaction is indexed once an item with its hash comes back. Newest items are on the last page.
      let pages = 1;
      while (walk && page.next_after !== null && pages < MAX_PAGES) {
        page = await fetchPage(page.next_after);
        items.push(...page.items);
        lastKnown = page.last_indexed_block;
        pages++;
      }
      if (vault !== null) for (const p of pending(vault)) if (items.some((i) => hasTx(i, p.hash))) pendingTxs.delete(p.hash);
      const left = vault === null ? [] : pending(vault);
      const base = { items, lastIndexedBlock: page.last_indexed_block, next: page.next_after, pending: left };
      return (left.length ? { state: "behind", ...base } : { state: "live", ...base }) as HistoryState<T>;
    } catch (e) {
      if (e instanceof IndexerUnavailableError) {
        return { state: "unavailable", lastKnownBlock: lastKnown, reason: e.message, pending: vault === null ? [] : pending(vault) } as HistoryState<T>;
      }
      throw e;
    }
  }

  const history: History = {
    source: o.source ?? "live",
    lastKnownBlock: () => lastKnown,
    track: (tx) => void pendingTxs.set(tx.hash, { ...tx, sentAt: tx.sentAt ?? now() }),
    pending,
    activity: (vault, q = {}) => read(vault, byTx, (after) => o.client.activity(vault, { ...q, ...(after === undefined ? {} : { after }) }), false),
    exposure: (vault, q = {}) => read(vault, byTx, (after) => o.client.exposure(vault, { ...q, ...(after === undefined ? {} : { after }) }), false),
    vaults: (q = {}) => read<VaultSummary>(null, () => false, (after) => o.client.vaults({ ...q, ...(after === undefined ? {} : { after }) }), false),
    async settle(vault, s = {}) {
      const sleep = s.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      const interval = s.intervalMs ?? 3000;
      const deadline = now() + (s.maxMs ?? 60_000);
      let r = await read(vault, byTx, (after) => o.client.activity(vault, after === undefined ? {} : { after }), true);
      while (r.state === "behind" && now() < deadline) {
        await sleep(interval);
        r = await read(vault, byTx, (after) => o.client.activity(vault, after === undefined ? {} : { after }), true);
      }
      return r;
    },
  };
  return history;
}

/**
 * The console's history. `NEXT_PUBLIC_INDEXER_URL` points it at the hosted indexer (KTD13). Without it, the
 * recorded sample is used and `source` says "fixture", so no screen presents sample data as live history.
 */
export function defaultHistory(): History {
  const url = process.env.NEXT_PUBLIC_INDEXER_URL;
  return url ? createHistory({ client: createIndexerClient({ baseUrl: url }), source: "live" }) : createHistory({ client: fixtureIndexerClient, source: "fixture" });
}
