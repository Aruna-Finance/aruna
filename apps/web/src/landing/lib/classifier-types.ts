// The classification shapes are owned by @aruna/classifier-core; this file only re-exports them
// and adds the app's own lookup result. Never define a classification type here (CLAUDE.md rule 10).
import type { Classification } from "@aruna/classifier-core";

export type { ClassEvidence, Classification, CodeRef, MutabilityBasis, RiskClass } from "@aruna/classifier-core";
export type { Network } from "@aruna/rpc";

/** Result of a lookup. A failed lookup is a normal outcome, not an exception. */
export type LookupResult =
  | { ok: true; classification: Classification; source: "live" }
  | { ok: false; reason: string };
