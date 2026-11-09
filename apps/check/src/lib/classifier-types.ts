// Mirrors docs/CLASSIFIER.md. These are the shapes @aruna/classifier-core will export.
// When that package exists, delete this file and import from it. Do not add logic here.

export type RiskClass =
  | "immutable_verified"
  | "local_upgradeable"
  | "global_by_account"
  | "unknown";

export type MutabilityBasis =
  | "no_detected_path"
  | "full_access_key"
  | "upgrade_imports"
  | "own_code"
  | "global_owner"
  | "undetermined";

export type CodeRef =
  | { kind: "local"; codeHash: string }
  | { kind: "global_hash"; globalHash: string }
  | { kind: "global_account"; ownerAccount: string };

export interface ClassEvidence {
  accountId: string;
  checkedAtBlock: number;
  codeRef: CodeRef | null;
  fullAccessKeyCount: number;
  functionCallKeyCount: number;
  /** from viewCode, NOT viewAccount. For global_by_account the two differ. */
  resolvedCodeHash: string | null;
  upgradeImports: string[];
  mutabilityBasis: MutabilityBasis;
  wasmParsed: boolean;
}

export interface Classification {
  class: RiskClass;
  evidence: ClassEvidence;
}

export type Network = "mainnet" | "testnet";

/** Result of a lookup. A failed lookup is a normal outcome, not an exception. */
export type LookupResult =
  | { ok: true; classification: Classification; source: "live" | "stub" }
  | { ok: false; reason: string };
