// The procedure in docs/CLASSIFIER.md, in order, stopping at the first match. Read that file before
// changing anything here: it is the authority, this is its only implementation.

import { SCANNED_IMPORTS } from "./scanned.js";
import type { AccessKeyList, ClassEvidence, Classification, CodeRef, RpcReader, ViewCode } from "./types.js";
import { decodeBase64, parseImports } from "./wasm-imports.js";

/** view_account.code_hash of an account with no local code, including every global-contract account. */
export const ZERO_HASH = "11111111111111111111111111111111";

const FULL_ACCESS = new Set(["full_access", "gas_key_full_access"]);

function countKeys(list: AccessKeyList): { full: number; functionCall: number } {
  const full = list.keys.filter((k) => FULL_ACCESS.has(k.permission)).length;
  return { full, functionCall: list.keys.length - full };
}

/** Scanned imports present in the module, in module order; null when the code is unavailable or unparseable. */
function scanCode(code: ViewCode): string[] | null {
  if (code === null) return null;
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(code.codeBase64);
  } catch {
    return null;
  }
  const parsed = parseImports(bytes);
  if (!parsed.ok) return null;
  const found = parsed.imports.filter((i) => i.kind === "func" && SCANNED_IMPORTS.includes(i.name)).map((i) => i.name);
  return [...new Set(found)];
}

/**
 * Classify `accountId`. Rejects only when the reader rejects (transport failure): a failed read is
 * not evidence about the contract, so it is never reported as `unknown`.
 */
export async function classify(accountId: string, rpc: RpcReader): Promise<Classification> {
  const account = await rpc.viewAccount(accountId);
  const evidence: ClassEvidence = {
    accountId,
    checkedAtBlock: account.blockHeight,
    codeRef: null,
    fullAccessKeyCount: 0,
    functionCallKeyCount: 0,
    monitoredCodeHash: null,
    resolvedCodeHash: null,
    upgradeImports: [],
    mutabilityBasis: "undetermined",
    wasmParsed: false,
  };
  if (!account.exists) return { class: "unknown", evidence };
  evidence.monitoredCodeHash = account.codeHash;

  // Step 1 — how is the code referenced. Global fields first: a zero code_hash does not mean no code.
  let codeRef: CodeRef | null = null;
  if (account.globalContractHash) codeRef = { kind: "global_hash", globalHash: account.globalContractHash };
  else if (account.globalContractAccountId) codeRef = { kind: "global_account", ownerAccount: account.globalContractAccountId };
  else if (account.codeHash !== ZERO_HASH) codeRef = { kind: "local", codeHash: account.codeHash };
  evidence.codeRef = codeRef;

  // Step 2 — can a key change the code. Read for every existing account so the evidence is complete.
  const keys = countKeys(await rpc.viewAccessKeyList(accountId));
  evidence.fullAccessKeyCount = keys.full;
  evidence.functionCallKeyCount = keys.functionCall;
  if (codeRef === null) return { class: "unknown", evidence };

  // Step 3 — the import section. Fetched for every class, so resolvedCodeHash is always the executed code.
  const code = await rpc.viewCode(accountId);
  evidence.resolvedCodeHash = code?.hash ?? null;
  const scanned = scanCode(code);
  evidence.wasmParsed = scanned !== null;
  evidence.upgradeImports = scanned ?? [];

  if (codeRef.kind === "global_account") {
    evidence.mutabilityBasis = "global_owner";
    return { class: "global_by_account", evidence };
  }
  if (keys.full > 0) {
    evidence.mutabilityBasis = "full_access_key";
    return { class: "local_upgradeable", evidence };
  }
  if (scanned === null) return { class: "unknown", evidence };
  if (scanned.length > 0) {
    evidence.mutabilityBasis = "upgrade_imports";
    return { class: "local_upgradeable", evidence };
  }
  if (codeRef.kind === "global_hash") {
    evidence.mutabilityBasis = "no_detected_path";
    return { class: "immutable_verified", evidence };
  }
  evidence.mutabilityBasis = "own_code";
  return { class: "local_upgradeable", evidence };
}
