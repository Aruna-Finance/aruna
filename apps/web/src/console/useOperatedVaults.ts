"use client";

import { useEffect, useMemo, useState } from "react";
import { defaultHistory } from "./history";

export type OperatedVaults = { state: "none" } | { state: "loading" } | { state: "unavailable" } | { state: "ok"; list: { vault: string }[] };

/**
 * The vaults the connected account operates but does not own. The registry does not record operators, so this comes from the
 * indexer; with no indexer in the build (the recorded sample is not real data) it says "unavailable" and the list stays empty.
 */
export function useOperatedVaults(account: string | null): OperatedVaults {
  const history = useMemo(() => defaultHistory(), []);
  const [out, setOut] = useState<OperatedVaults>({ state: account ? "loading" : "none" });
  useEffect(() => {
    if (!account) {
      setOut({ state: "none" });
      return;
    }
    if (history.source === "fixture") {
      setOut({ state: "unavailable" });
      return;
    }
    let alive = true;
    setOut({ state: "loading" });
    history
      .vaults({ operator: account })
      .then((r) => alive && setOut(r.state === "unavailable" ? { state: "unavailable" } : { state: "ok", list: r.items.map((v) => ({ vault: v.vault })) }))
      .catch(() => alive && setOut({ state: "unavailable" }));
    return () => {
      alive = false;
    };
  }, [account, history]);
  return out;
}
