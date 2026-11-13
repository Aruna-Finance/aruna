"use client";

import { fetchViewTransport, Pool, type Coverage } from "@aruna/sdk/coverage";
import { useEffect, useMemo, useState } from "react";
import { createTestnetReads } from "./chain-reads";
import { claimRows, claimSteps, exposureKey, reportRow, startable, type ClaimRow, type ExposureRead, type ReportRow, type Startable, type StoredReport } from "./data/claims-live";
import { POOL, REGISTRY } from "./data/price";

export type VaultClaims =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; coverages: Coverage[]; reports: ReportRow[]; claims: ClaimRow[]; startable: Startable[] };

/**
 * The drift reports that bear on a vault's coverages and the claims made on them, read from the registry, the pool and the
 * vault. A read that fails is an error for the whole screen: a partial list could hide a paid claim.
 */
export function useVaultClaims(vault: string, refreshKey: unknown = 0): VaultClaims {
  const [out, setOut] = useState<VaultClaims>({ state: "loading" });
  const reads = useMemo(() => createTestnetReads(), []);
  useEffect(() => {
    let alive = true;
    setOut((o) => (o.state === "ok" ? o : { state: "loading" }));
    (async () => {
      const pool = new Pool({ pool: POOL, transport: fetchViewTransport({ network: "testnet" }) });
      const coverages = await pool.coverages({ vault });
      const targets = [...new Set(coverages.map((c) => c.target))];
      const latest = new Map<string, ReportRow>();
      const reports = new Map<number, ReportRow>();
      await Promise.all(
        targets.map(async (t) => {
          const r = await reads.view<StoredReport | null>(REGISTRY, "latest_report", { target: t });
          if (r) {
            latest.set(t, reportRow(r));
            reports.set(r.id, reportRow(r));
          }
        }),
      );
      const claimed = [...new Set(coverages.flatMap((c) => c.claims.map((k) => k.report_id)))].filter((id) => !reports.has(id));
      await Promise.all(
        claimed.map(async (id) => {
          const r = await reads.view<StoredReport | null>(REGISTRY, "get_report", { id });
          if (r) reports.set(id, reportRow(r));
        }),
      );
      // Exposure the pool counted for each NEAR claim: before the changed block, and before the block it counted from.
      const exposure = new Map<string, ExposureRead>();
      await Promise.all(
        claimSteps(coverages, reports)
          .filter((s) => s.coverage.token === "near" && s.changedAtBlock !== null)
          .map(async (s) => {
            const ask = (block: number) => reads.view<string>(vault, "exposure_before", { agent: s.coverage.agent, target: s.coverage.target, token: "near", block });
            const [untilChange, untilStart] = await Promise.all([ask(s.changedAtBlock as number), ask(s.paidThroughBlock)]);
            exposure.set(exposureKey(s.coverage.id, s.index), { untilChange, untilStart });
          }),
      );
      return { coverages, reports: [...reports.values()].sort((a, b) => b.id - a.id), claims: claimRows(coverages, reports, exposure), startable: startable(coverages, latest) };
    })()
      .then((r) => alive && setOut({ state: "ok", ...r }))
      .catch((e: unknown) => alive && setOut({ state: "error", message: e instanceof Error ? e.message : "The registry or pool could not be read." }));
    return () => {
      alive = false;
    };
  }, [vault, reads, refreshKey]);
  return out;
}
