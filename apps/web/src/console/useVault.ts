"use client";

import { useSyncExternalStore } from "react";
import { vaultStore } from "./data/vault-mock";
import type { VaultState } from "./data/vault";

/** The vault the console is looking at. Re-renders when the owner's edits change it. */
export function useVault(): VaultState {
  return useSyncExternalStore(vaultStore.subscribe, vaultStore.get, vaultStore.get);
}
