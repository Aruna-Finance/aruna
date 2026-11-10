"use client";

import { useSyncExternalStore } from "react";
import { claimsStore } from "./data/claims-mock";
import type { ClaimsState } from "./data/claims";

/** Drift reports and claims. Readable by every role. */
export function useClaims(): ClaimsState {
  return useSyncExternalStore(claimsStore.subscribe, claimsStore.get, claimsStore.get);
}
