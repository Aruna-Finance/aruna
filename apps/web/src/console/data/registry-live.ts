import type { ClassRecord } from "@aruna/sdk/coverage";
import type { ChainReads } from "../wallet-transport";
import { reportRow, type ReportRow, type StoredReport } from "./claims-live";
import { REGISTRY } from "./price";
import { MAX_CLASS_AGE_BLOCKS } from "./types";

// What the registry holds about a target: the class a classifier recorded, who watches it, whether that attestor is alive, and the
// latest drift report. A vault checks this record, never a live read. The classification itself is the one engine's
// (@aruna/classifier-core); nothing here decides a class.

export type RiskClassName = ClassRecord["class"];

export interface RegistryTarget {
  target: string;
  record: ClassRecord | null;
  attestor: string | null;
  heartbeatFresh: boolean;
  latest: ReportRow | null;
}

export async function readRegistryTarget(reads: Pick<ChainReads, "view">, target: string, registry = REGISTRY): Promise<RegistryTarget> {
  const [record, attestor, heartbeatFresh, latest] = await Promise.all([
    reads.view<ClassRecord | null>(registry, "get_class", { target }),
    reads.view<string | null>(registry, "assigned_attestor", { target }),
    reads.view<boolean>(registry, "heartbeat_fresh", { target }),
    reads.view<StoredReport | null>(registry, "latest_report", { target }),
  ]);
  return { target, record, attestor, heartbeatFresh, latest: latest ? reportRow(latest) : null };
}

export type Agreement = "agree" | "differ" | "not_recorded" | "live_unavailable";

/** Whether the class on record is the class a fresh run of the engine gives. A difference is a reason to refresh, not a verdict. */
export function agreement(recorded: RiskClassName | null, live: RiskClassName | null): Agreement {
  if (recorded === null) return "not_recorded";
  if (live === null) return "live_unavailable";
  return recorded === live ? "agree" : "differ";
}

export const AGREEMENT_TEXT: Record<Agreement, string> = {
  agree: "The recorded class is the class a fresh run gives.",
  differ: "The recorded class differs from a fresh run. A vault still checks the recorded one until a classifier records the new class.",
  not_recorded: "No classifier has recorded this target in this registry, so a vault cannot cover it.",
  live_unavailable: "The fresh run did not answer, so the two could not be compared.",
};

export type CodeChange = "same" | "changed" | "unknown";

/** Whether the code the target resolves to now is the code that was recorded. A class can stay the same while the code changes. */
export function codeChange(recordedHash: string | null | undefined, liveHash: string | null | undefined): CodeChange {
  if (!recordedHash || !liveHash) return "unknown";
  return recordedHash === liveHash ? "same" : "changed";
}

export const CODE_CHANGE_TEXT: Record<CodeChange, string> = {
  same: "The code behind the target is the code that was recorded.",
  changed: "The code behind the target is not the code that was recorded. The class is the same, but the code has changed since the record was written.",
  unknown: "The recorded and the fresh code hash could not both be read, so the code could not be compared.",
};

export interface Freshness {
  age: number;
  stale: boolean;
}

/** Blocks since the record was written, against the bound after which a vault refuses a spend with ARUNA_CLASS_STALE. */
export function freshnessOf(record: Pick<ClassRecord, "classified_at_block">, head: number): Freshness {
  const age = Math.max(0, head - record.classified_at_block);
  return { age, stale: age > MAX_CLASS_AGE_BLOCKS };
}

/** The targets the console lists: the seeded ones first, then every target the pool has covered, once each. */
export function candidateTargets(seed: readonly string[], covered: readonly string[]): string[] {
  return [...new Set([...seed, ...covered])];
}

/** A valid target id for the lookup field: a NEAR account id, lower case, no spaces. */
export const targetIdProblem = (v: string): string | null =>
  /^(?=.{2,64}$)[a-z0-9]+([-_.][a-z0-9]+)*$/.test(v.trim()) ? null : "Enter a NEAR account id, such as drift-target.arunafi.testnet.";
