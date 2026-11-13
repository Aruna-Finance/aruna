"use client";

import { fetchViewTransport, Registry } from "@aruna/sdk/coverage";
import { useEffect, useState } from "react";
import { REGISTRY } from "./data/price";
import { ownedVaults, type OwnedVault } from "./data/owned-vaults";

export type OwnedVaults = { state: "none" } | { state: "loading" } | { state: "error"; message: string } | { state: "ok"; list: OwnedVault[] };

/** The vaults the connected account owns, from the registry. "none" while no wallet is connected. */
export function useOwnedVaults(account: string | null): OwnedVaults {
  const [out, setOut] = useState<OwnedVaults>({ state: account ? "loading" : "none" });
  useEffect(() => {
    if (!account) {
      setOut({ state: "none" });
      return;
    }
    let alive = true;
    setOut({ state: "loading" });
    ownedVaults(new Registry({ registry: REGISTRY, transport: fetchViewTransport({ network: "testnet" }) }), account)
      .then((list) => alive && setOut({ state: "ok", list }))
      .catch((e: unknown) => alive && setOut({ state: "error", message: e instanceof Error ? e.message : "The registry could not be read." }));
    return () => {
      alive = false;
    };
  }, [account]);
  return out;
}
