"use client";

import type { ActivityItem, ExposureRow } from "@aruna/indexer/client";
import { useEffect, useMemo, useState } from "react";
import { defaultHistory, type History, type HistoryState } from "./history";

const POLL_MS = 15_000;

/**
 * A vault's activity and exposure from the history client, refreshed every 15 seconds so a refusal shows within a
 * minute (L5 done-when). It never decides anything: current state comes from readVault, and a screen still renders
 * when this is `unavailable` (AE2).
 */
export function useVaultHistory(vault: string, o: { agent?: string; refreshKey?: unknown } = {}) {
  const history = useMemo<History>(() => defaultHistory(), []);
  const [activity, setActivity] = useState<HistoryState<ActivityItem> | null>(null);
  const [exposure, setExposure] = useState<HistoryState<ExposureRow> | null>(null);

  useEffect(() => {
    let alive = true;
    const q = o.agent ? { agent: o.agent } : {};
    const load = () => {
      history.activity(vault, q).then((r) => alive && setActivity(r), () => alive && setActivity({ state: "unavailable", lastKnownBlock: history.lastKnownBlock(), reason: "The read failed.", pending: [] }));
      history.exposure(vault, q).then((r) => alive && setExposure(r), () => alive && setExposure({ state: "unavailable", lastKnownBlock: history.lastKnownBlock(), reason: "The read failed.", pending: [] }));
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [history, vault, o.agent, o.refreshKey]);

  return { history, activity, exposure };
}

/** Newest first. The indexer returns oldest first; the list shows what just happened at the top. */
export function newestFirst<T extends { seq: number }>(h: HistoryState<T> | null): T[] {
  return h && h.state !== "unavailable" ? [...h.items].sort((a, b) => b.seq - a.seq) : [];
}
