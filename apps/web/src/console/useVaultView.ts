"use client";

import { readVault, type VaultView } from "@aruna/sdk";
import { useEffect, useState } from "react";

export type VaultViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; view: VaultView };

/** Reads a vault from the public RPC through the SDK. A failed read is an ordinary outcome, not an exception. */
export function useVaultView(vault: string): VaultViewState {
  const [state, setState] = useState<VaultViewState>({ status: vault ? "loading" : "idle" });

  useEffect(() => {
    if (!vault) {
      setState({ status: "idle" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    readVault(vault, { network: "testnet" })
      .then((view) => live && setState({ status: "ok", view }))
      .catch((e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : "The read failed." }));
    return () => {
      live = false;
    };
  }, [vault]);

  return state;
}
