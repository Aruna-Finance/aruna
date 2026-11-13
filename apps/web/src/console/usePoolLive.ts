"use client";

import { fetchViewTransport, Pool, type Book, type Coverage } from "@aruna/sdk/coverage";
import { useEffect, useMemo, useState } from "react";
import { createTestnetReads } from "./chain-reads";
import { POOL } from "./data/price";
import { tokensOf } from "./data/pool-live";

export type PoolLive =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; head: number; coverages: Coverage[]; books: Map<string, Book>; shares: Map<string, string> };

const BATCH = 10;

/**
 * Every coverage and each token's book as the pool reports them, and the connected account's shares. A read that fails is an
 * error for the whole screen: a partial book would understate what the pool owes.
 */
export function usePoolLive(account: string | null): PoolLive {
  const [out, setOut] = useState<PoolLive>({ state: "loading" });
  const reads = useMemo(() => createTestnetReads(), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const pool = new Pool({ pool: POOL, transport: fetchViewTransport({ network: "testnet" }) });
      const [head, n] = await Promise.all([reads.headBlock(), pool.coverageCount()]);
      const coverages: Coverage[] = [];
      for (let from = 0; from < n; from += BATCH) {
        const ids = Array.from({ length: Math.min(BATCH, n - from) }, (_, i) => from + i);
        for (const c of await Promise.all(ids.map((id) => pool.coverage(id)))) if (c) coverages.push(c);
      }
      const tokens = tokensOf(coverages.map((c) => c));
      const books = new Map<string, Book>();
      const shares = new Map<string, string>();
      await Promise.all(
        tokens.map(async (t) => {
          books.set(t, await pool.book(t));
          if (account) shares.set(t, await pool.shares(account, t));
        }),
      );
      return { state: "ok", head, coverages, books, shares } as const;
    })()
      .then((v) => alive && setOut(v))
      .catch((e: unknown) => alive && setOut({ state: "error", message: e instanceof Error ? e.message : "The pool could not be read." }));
    return () => {
      alive = false;
    };
  }, [account, reads]);
  return out;
}
