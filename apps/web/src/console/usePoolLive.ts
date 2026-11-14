"use client";

import { fetchViewTransport, Pool, type Book, type Coverage } from "@aruna/sdk/coverage";
import { useEffect, useMemo, useState } from "react";
import { createTestnetReads, type TestnetReads } from "./chain-reads";
import { BOOK_TOKENS, type WalletToken } from "./data/pool-live";
import { POOL } from "./data/price";

export type PoolLive =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; head: number; coverages: Coverage[]; books: Map<string, Book>; shares: Map<string, string> };

const BATCH = 10;
const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Every coverage, the two books the screen lists and the account's shares in them, as the pool reports them. A read that
 * fails rejects the whole load: a partial book would understate what the pool owes.
 */
export async function loadPoolLive(o: {
  pool: Pick<Pool, "coverageCount" | "coverage" | "book" | "shares">;
  reads: Pick<TestnetReads, "headBlock">;
  account: string | null;
}): Promise<Extract<PoolLive, { state: "ok" }>> {
  const [head, n] = await Promise.all([o.reads.headBlock(), o.pool.coverageCount()]);
  const coverages: Coverage[] = [];
  for (let from = 0; from < n; from += BATCH) {
    const ids = Array.from({ length: Math.min(BATCH, n - from) }, (_, i) => from + i);
    for (const c of await Promise.all(ids.map((id) => o.pool.coverage(id)))) if (c) coverages.push(c);
  }
  const rows = await Promise.all(BOOK_TOKENS.map(async (t) => [t, await o.pool.book(t), o.account ? await o.pool.shares(o.account, t) : null] as const));
  const books = new Map(rows.map(([t, b]) => [t, b] as const));
  const shares = new Map(rows.flatMap(([t, , s]) => (s === null ? [] : [[t, s] as const])));
  return { state: "ok", head, coverages, books, shares };
}

/**
 * Every coverage and each book as the pool reports them, and the connected account's shares. `refreshKey` re-reads the
 * contract after a confirmed transaction; the previous figures stay on screen until the new ones arrive.
 */
export function usePoolLive(account: string | null, refreshKey = 0): PoolLive {
  const [out, setOut] = useState<PoolLive>({ state: "loading" });
  const reads = useMemo(() => createTestnetReads(), []);
  useEffect(() => {
    let alive = true;
    loadPoolLive({ pool: new Pool({ pool: POOL, transport: fetchViewTransport({ network: "testnet" }) }), reads, account })
      .then((v) => alive && setOut(v))
      .catch((e: unknown) => alive && setOut({ state: "error", message: msg(e, "The pool could not be read.") }));
    return () => {
      alive = false;
    };
  }, [account, reads, refreshKey]);
  return out;
}

/**
 * What the account holds of each token, for the guards on the forms: its balance, and for a token whether it is registered
 * there. Each token is read on its own, so one that fails is an error for that token only.
 */
export async function loadWalletTokens(o: { reads: Pick<TestnetReads, "balance" | "view">; account: string; tokens: readonly string[] }): Promise<Map<string, WalletToken>> {
  const rows = await Promise.all(
    o.tokens.map(async (t): Promise<readonly [string, WalletToken]> => {
      try {
        if (t === "near") return [t, { state: "ok", balance: (await o.reads.balance(o.account)) ?? 0n, registered: true }];
        const [balance, storage] = await Promise.all([
          o.reads.view<string>(t, "ft_balance_of", { account_id: o.account }),
          o.reads.view<unknown>(t, "storage_balance_of", { account_id: o.account }),
        ]);
        return [t, { state: "ok", balance: BigInt(balance), registered: storage !== null }];
      } catch (e) {
        return [t, { state: "error", message: msg(e, `${t} could not be read.`) }];
      }
    }),
  );
  return new Map(rows);
}

/** The account's holdings per token; a token absent from the map has not answered yet. Re-read when `refreshKey` changes. */
export function useWalletTokens(account: string | null, refreshKey = 0): ReadonlyMap<string, WalletToken> {
  const [map, setMap] = useState<ReadonlyMap<string, WalletToken>>(new Map());
  const reads = useMemo(() => createTestnetReads(), []);
  useEffect(() => {
    if (!account) {
      setMap(new Map());
      return;
    }
    let alive = true;
    loadWalletTokens({ reads, account, tokens: BOOK_TOKENS }).then((m) => alive && setMap(m));
    return () => {
      alive = false;
    };
  }, [account, reads, refreshKey]);
  return map;
}
