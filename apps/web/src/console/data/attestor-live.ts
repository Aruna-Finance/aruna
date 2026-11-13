import type { ChainReads } from "../wallet-transport";
import { REGISTRY } from "./price";
import type { RegistryTarget } from "./registry-live";

// Attestors as the registry holds them. An attestor is a trust assumption of this system; nothing here removes it. The console only
// reads: heartbeats, reports and drift claims are sent from the attestor's own account, not from an owner's console.

/** Pinned to contracts/common/src/params.rs by a test. */
export const HEARTBEAT_STALE_BLOCKS = 600;

export interface AttestorRecord {
  signing_key: string;
  bond: string;
  last_heartbeat: number;
  registered_at: number;
}

export interface AttestorInfo {
  id: string;
  record: AttestorRecord | null;
}

export type AttestorState = "alive" | "stale" | "no_bond" | "unknown";

/** The same test the registry applies in `heartbeat_fresh`: a live bond and a heartbeat within the bound. */
export function attestorState(a: AttestorRecord | null, head: number): AttestorState {
  if (!a) return "unknown";
  if (BigInt(a.bond) === 0n) return "no_bond";
  return head - a.last_heartbeat <= HEARTBEAT_STALE_BLOCKS ? "alive" : "stale";
}

export const STATE_TEXT: Record<AttestorState, string> = {
  alive: "Heartbeat fresh",
  stale: "Heartbeat stale: the pool refuses new coverage on its targets",
  no_bond: "No bond (slashed): it cannot report",
  unknown: "Not registered in this registry",
};

export const heartbeatAge = (a: AttestorRecord, head: number) => Math.max(0, head - a.last_heartbeat);

export interface AttestorGroup {
  attestor: string;
  targets: RegistryTarget[];
}

/** Targets grouped by their assigned attestor (in order of first appearance), and the targets with none. */
export function groupByAttestor(rows: readonly RegistryTarget[]): { groups: AttestorGroup[]; unassigned: RegistryTarget[] } {
  const map = new Map<string, RegistryTarget[]>();
  const unassigned: RegistryTarget[] = [];
  for (const r of rows) {
    if (!r.attestor) unassigned.push(r);
    else map.set(r.attestor, [...(map.get(r.attestor) ?? []), r]);
  }
  return { groups: [...map.entries()].map(([attestor, targets]) => ({ attestor, targets })), unassigned };
}

export async function readAttestor(reads: Pick<ChainReads, "view">, id: string, registry = REGISTRY): Promise<AttestorInfo> {
  return { id, record: await reads.view<AttestorRecord | null>(registry, "get_attestor", { attestor: id }) };
}
