// Drift reports and the exact bytes an attestor signs (plan KTD6). Mirrors
// contracts/common/src/drift.rs; fixtures/golden/drift-report.json pins both sides to the same bytes.
import { createPrivateKey, sign as edSign } from "node:crypto";

export type CodeRef =
  | { kind: "local"; code_hash: string }
  | { kind: "global_hash"; global_hash: string }
  | { kind: "global_account"; owner_account: string };

export type DriftChannel = "resolved_code" | "deploy_contract" | "use_global_contract" | "deploy_global_contract";

/** The contract's JSON shape (snake_case), so a report can be passed to `report_drift` as is. */
export interface DriftReport {
  target: string;
  observed_at_block: number;
  changed_at_block: number;
  before_ref: CodeRef;
  after_ref: CodeRef;
  before_resolved_hash: string;
  after_resolved_hash: string;
  channel: DriftChannel;
  attestor: string;
  nonce: number;
  expires_at: number;
}

export const SIGNING_PREFIX = "aruna:drift-report:v1\n";
const CODE_REF_INDEX = { local: 0, global_hash: 1, global_account: 2 } as const;
const CHANNEL_INDEX: Record<DriftChannel, number> = { resolved_code: 0, deploy_contract: 1, use_global_contract: 2, deploy_global_contract: 3 };

class Writer {
  private parts: Buffer[] = [];
  str(s: string) {
    const b = Buffer.from(s, "utf8");
    this.u32(b.length);
    this.parts.push(b);
  }
  u8(n: number) {
    this.parts.push(Buffer.from([n]));
  }
  u32(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    this.parts.push(b);
  }
  u64(n: number) {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`not a u64 block height or nonce: ${n}`);
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    this.parts.push(b);
  }
  codeRef(r: CodeRef) {
    this.u8(CODE_REF_INDEX[r.kind]);
    this.str(r.kind === "local" ? r.code_hash : r.kind === "global_hash" ? r.global_hash : r.owner_account);
  }
  bytes() {
    return Buffer.concat(this.parts);
  }
}

/** The prefix, then the report's borsh encoding in field order. */
export function signingBytes(r: DriftReport): Buffer {
  const w = new Writer();
  w.str(r.target);
  w.u64(r.observed_at_block);
  w.u64(r.changed_at_block);
  w.codeRef(r.before_ref);
  w.codeRef(r.after_ref);
  w.str(r.before_resolved_hash);
  w.str(r.after_resolved_hash);
  w.u8(CHANNEL_INDEX[r.channel]);
  w.str(r.attestor);
  w.u64(r.nonce);
  w.u64(r.expires_at);
  return Buffer.concat([Buffer.from(SIGNING_PREFIX, "utf8"), w.bytes()]);
}

/** Signs with a raw 32-byte ed25519 seed. Returns the 64-byte signature. */
export function signReport(r: DriftReport, seed: Buffer): Buffer {
  if (seed.length !== 32) throw new Error("an ed25519 seed is 32 bytes");
  // PKCS#8 wrapper for a raw ed25519 private key (RFC 8410).
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  return edSign(null, signingBytes(r), createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
}
