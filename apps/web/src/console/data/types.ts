import type { Classification } from "@/landing/lib/classifier-types";

// The console reads through these ports. Today a mock adapter answers; when @aruna/sdk and the indexer
// exist, an adapter over them replaces the mock and the screens do not change.

/** Assumption, not a measurement: how old a recorded class may be before a vault refuses to spend on it. */
export const MAX_CLASS_AGE_BLOCKS = 7200;

export interface TargetRecord {
  id: string;
  label: string;
  classification: Classification;
  /** Block at which a classifier recorded this class on chain. */
  classifiedAtBlock: number;
  /** Block at which the vault cache last pulled it. Freshness is measured from here. */
  fetchedAtBlock: number;
  /** A drift report froze this target. */
  frozen: boolean;
}

/** A canned test case, because the browser cannot reach RPC from the mock. */
export interface TargetPreset {
  key: string;
  id: string;
  title: string;
}

export interface TargetsReader {
  currentBlock(): Promise<number>;
  list(): Promise<TargetRecord[]>;
  get(id: string): Promise<TargetRecord | null>;
  presets(): Promise<TargetPreset[]>;
  /** Mock only: records the canned result for a test case. The real adapter asks the classifier set. */
  classify(presetKey: string): Promise<{ record: TargetRecord; added: boolean }>;
}
