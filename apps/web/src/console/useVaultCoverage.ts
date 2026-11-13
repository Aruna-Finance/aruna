"use client";

import { fetchViewTransport, Pool } from "@aruna/sdk/coverage";
import { useEffect, useMemo, useState } from "react";
import { createTestnetReads } from "./chain-reads";
import { coverageRows, type CoverageRow } from "./data/coverage-live";
import { POOL } from "./data/price";

export type VaultCoverage = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; rows: CoverageRow[]; head: number };

/** The coverages the pool holds for a vault, with the latest block they are judged at. Read from the pool, not the indexer. */
export function useVaultCoverage(vault: string, refreshKey: unknown = 0): VaultCoverage {
  const [out, setOut] = useState<VaultCoverage>({ state: "loading" });
  const reads = useMemo(() => createTestnetReads(), []);
  useEffect(() => {
    let alive = true;
    setOut((o) => (o.state === "ok" ? o : { state: "loading" }));
    const pool = new Pool({ pool: POOL, transport: fetchViewTransport({ network: "testnet" }) });
    Promise.all([pool.coverages({ vault }), reads.headBlock()])
      .then(([list, head]) => alive && setOut({ state: "ok", rows: coverageRows(list, head), head }))
      .catch((e: unknown) => alive && setOut({ state: "error", message: e instanceof Error ? e.message : "The pool could not be read." }));
    return () => {
      alive = false;
    };
  }, [vault, reads, refreshKey]);
  return out;
}
