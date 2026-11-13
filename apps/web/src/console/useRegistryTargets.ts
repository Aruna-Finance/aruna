"use client";

import { fetchViewTransport, Pool } from "@aruna/sdk/coverage";
import { useEffect, useMemo, useState } from "react";
import type { Classification } from "@/landing/lib/classifier-types";
import { lookup } from "@/landing/lib/classifier-adapter";
import { createTestnetReads } from "./chain-reads";
import { SEED_TARGETS } from "./data/factory";
import { POOL } from "./data/price";
import { candidateTargets, readRegistryTarget, type RegistryTarget } from "./data/registry-live";

export type RegistryTargets = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; head: number; rows: RegistryTarget[] };

/** The seeded targets and every target the pool has covered, as the registry records them. A failed read is an error, never a short list. */
export function useRegistryTargets(): RegistryTargets {
  const [out, setOut] = useState<RegistryTargets>({ state: "loading" });
  const reads = useMemo(() => createTestnetReads(), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const pool = new Pool({ pool: POOL, transport: fetchViewTransport({ network: "testnet" }) });
      const n = await pool.coverageCount();
      const covered: string[] = [];
      for (let from = 0; from < n; from += 10) {
        const ids = Array.from({ length: Math.min(10, n - from) }, (_, i) => from + i);
        for (const c of await Promise.all(ids.map((id) => pool.coverage(id)))) if (c) covered.push(c.target);
      }
      const [head, rows] = await Promise.all([reads.headBlock(), Promise.all(candidateTargets(SEED_TARGETS, covered).map((t) => readRegistryTarget(reads, t)))]);
      return { state: "ok", head, rows } as const;
    })()
      .then((v) => alive && setOut(v))
      .catch((e: unknown) => alive && setOut({ state: "error", message: e instanceof Error ? e.message : "The registry could not be read." }));
    return () => {
      alive = false;
    };
  }, [reads]);
  return out;
}

export type RegistryTargetView =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; head: number; target: RegistryTarget; live: Classification | null; liveProblem: string | null };

/** One target: the registry's record, and a fresh run of the engine beside it. A fresh run that fails does not hide the record. */
export function useRegistryTarget(id: string): RegistryTargetView {
  const [out, setOut] = useState<RegistryTargetView>({ state: "loading" });
  const reads = useMemo(() => createTestnetReads(), []);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setOut({ state: "loading" });
    Promise.all([reads.headBlock(), readRegistryTarget(reads, id), lookup(id, "testnet")])
      .then(([head, target, fresh]) => alive && setOut({ state: "ok", head, target, live: fresh.ok ? fresh.classification : null, liveProblem: fresh.ok ? null : fresh.reason }))
      .catch((e: unknown) => alive && setOut({ state: "error", message: e instanceof Error ? e.message : "The registry could not be read." }));
    return () => {
      alive = false;
    };
  }, [id, reads]);
  return out;
}
