"use client";

import { readVault, type VaultView } from "@aruna/sdk";
import { isValidAccountId } from "@aruna/rpc";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { browserStore, listKeys } from "./agent-keys";
import { newestOwned } from "./data/owned-vaults";
import { chosenVault, VAULT_STORE_KEY } from "./live-vault";
import { useOwnedVaults } from "./useOwnedVaults";
import { useWallet } from "./WalletContext";

export type LiveVault =
  | { status: "none" }
  | { status: "loading"; vault: string }
  | { status: "error"; vault: string; message: string }
  | { status: "ok"; vault: string; view: VaultView; held: string[]; refresh: () => void };

const NETWORK = "testnet";

/** The vault being managed, read live from the public RPC. Refreshable after each action. */
export function useLiveVault(): LiveVault {
  const fromUrl = useSearchParams().get("vault");
  const [stored, setStored] = useState<string | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<LiveVault>({ status: "none" });

  useEffect(() => {
    try {
      setStored(localStorage.getItem(VAULT_STORE_KEY));
    } catch {
      setStored(null); /* storage blocked: the link still works */
    }
  }, []);

  const { accountId } = useWallet();
  const owned = useOwnedVaults(accountId ?? null);
  // Nothing asked for and nothing remembered: open the connected account's newest vault, as the registry lists it.
  const asked = chosenVault(fromUrl, stored ?? null, isValidAccountId);
  const vault = asked ?? (owned.state === "ok" ? newestOwned(owned.list) : null);
  // Until the remembered vault has been looked up, say so instead of showing sample data for a moment.
  const checking = (stored === undefined && !fromUrl) || (!asked && owned.state === "loading");

  useEffect(() => {
    if (!vault || vault !== fromUrl) return;
    try {
      localStorage.setItem(VAULT_STORE_KEY, vault);
    } catch {
      /* ignore */
    }
  }, [vault, fromUrl]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!vault) {
      setState({ status: "none" });
      return;
    }
    let live = true;
    setState((s) => (s.status === "ok" && s.vault === vault ? s : { status: "loading", vault }));
    readVault(vault, { network: NETWORK })
      .then((view) => live && setState({ status: "ok", vault, view, held: listKeys(browserStore(), NETWORK, vault), refresh }))
      .catch((e: unknown) => live && setState({ status: "error", vault, message: e instanceof Error ? e.message : "The read failed." }));
    return () => {
      live = false;
    };
  }, [vault, tick, refresh]);

  if (checking) return { status: "loading", vault: "" };
  // The vault is known but its read has not started yet: still loading, not "no vault".
  if (vault && state.status === "none") return { status: "loading", vault };
  return state;
}
