// Observation and diff (plan KTD4, KTD5). Each poll classifies a target with the shared engine; a
// change between two observations becomes a drift report. The channel is inferred from what changed
// in state, not from reading transactions, which this attestor does not do (docs/ATTESTOR.md).
import { classify, type CodeRef as EngineCodeRef, type RpcReader } from "@aruna/classifier-core";
import type { CodeRef, DriftChannel, DriftReport } from "./report.js";

/** What one poll saw. A failed RPC read yields no observation, so it can never look like a change. */
export interface Observation {
  target: string;
  block: number;
  codeRef: EngineCodeRef | null;
  resolvedHash: string | null;
}

export async function observe(target: string, reader: RpcReader): Promise<Observation> {
  const { evidence } = await classify(target, reader);
  return { target, block: evidence.checkedAtBlock, codeRef: evidence.codeRef, resolvedHash: evidence.resolvedCodeHash };
}

/** The engine's camelCase ref in the contract's snake_case shape. */
export function toContractRef(r: EngineCodeRef): CodeRef {
  switch (r.kind) {
    case "local":
      return { kind: "local", code_hash: r.codeHash };
    case "global_hash":
      return { kind: "global_hash", global_hash: r.globalHash };
    case "global_account":
      return { kind: "global_account", owner_account: r.ownerAccount };
  }
}

function sameRef(a: EngineCodeRef, b: EngineCodeRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** KTD4. Null when nothing that runs has changed. */
export function channelOf(prev: Observation, cur: Observation): DriftChannel | null {
  if (!prev.codeRef || !cur.codeRef || !prev.resolvedHash || !cur.resolvedHash) return null;
  if (prev.resolvedHash === cur.resolvedHash && sameRef(prev.codeRef, cur.codeRef)) return null;
  if (prev.codeRef.kind === "local" && cur.codeRef.kind === "local") return "deploy_contract";
  if (!sameRef(prev.codeRef, cur.codeRef)) return "use_global_contract";
  if (cur.codeRef.kind === "global_account") return "deploy_global_contract";
  return "resolved_code";
}

/**
 * The report for a change between two observations, or null. `changed_at_block` is the block after
 * the last unchanged observation: the earliest block the change cannot be ruled out at (KTD5).
 */
export function reportFor(prev: Observation, cur: Observation, attestor: string, nonce: number, ttlBlocks: number): DriftReport | null {
  const channel = channelOf(prev, cur);
  if (!channel || !prev.codeRef || !cur.codeRef || !prev.resolvedHash || !cur.resolvedHash) return null;
  if (prev.resolvedHash === cur.resolvedHash) return null; // a ref move to identical code; the registry would reject it
  return {
    target: cur.target,
    observed_at_block: cur.block,
    changed_at_block: prev.block + 1,
    before_ref: toContractRef(prev.codeRef),
    after_ref: toContractRef(cur.codeRef),
    before_resolved_hash: prev.resolvedHash,
    after_resolved_hash: cur.resolvedHash,
    channel,
    attestor,
    nonce,
    expires_at: cur.block + ttlBlocks,
  };
}
