"use client";

import { useSyncExternalStore } from "react";
import { coverageStore } from "./data/coverage-mock";
import type { CoverageState } from "./data/coverage";

/** The owner's coverage policies, the attestors and the pool capital. */
export function useCoverage(): CoverageState {
  return useSyncExternalStore(coverageStore.subscribe, coverageStore.get, coverageStore.get);
}
