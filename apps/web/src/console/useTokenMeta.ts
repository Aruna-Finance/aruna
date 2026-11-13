"use client";

import { useEffect, useMemo, useState } from "react";
import { createTestnetReads } from "./chain-reads";
import { metaOf, type TokenMeta } from "./data/token-amount";

const cache = new Map<string, Promise<TokenMeta | null>>();

/** Symbol and decimals of each token contract, from its own `ft_metadata`. A token that does not answer stays unread. */
export function useTokenMeta(tokens: readonly string[]): ReadonlyMap<string, TokenMeta> {
  const reads = useMemo(() => createTestnetReads(), []);
  const [meta, setMeta] = useState<ReadonlyMap<string, TokenMeta>>(new Map());
  const key = [...new Set(tokens.filter((t) => t !== "near"))].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    Promise.all(
      key.split(",").map(async (t) => {
        if (!cache.has(t)) cache.set(t, reads.view<unknown>(t, "ft_metadata", {}).then(metaOf, () => null));
        return [t, await cache.get(t)!] as const;
      }),
    ).then((rows) => alive && setMeta(new Map(rows.flatMap(([t, m]) => (m ? [[t, m] as const] : [])))));
    return () => {
      alive = false;
    };
  }, [key, reads]);
  return meta;
}
