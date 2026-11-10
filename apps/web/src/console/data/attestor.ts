import { channelsOf, upgradeChannel, type ChannelKey } from "./channels";
import type { TargetRecord } from "./types";

// Mock attestor console state: changes the attestor has seen and not yet reported. Reports themselves live in the
// claims store. The real attestor is packages/attestor, which is empty today.

export interface Detection {
  id: string;
  target: string;
  channel: ChannelKey;
  /** The global contract owner whose redeploy caused it, when there is one. */
  owner: string | null;
  /** Other targets that run the same global contract. */
  affects: string[];
}

export function detectionFor(target: TargetRecord, all: TargetRecord[], n: number): Detection {
  const ref = target.classification.evidence.codeRef;
  const owner = ref?.kind === "global_account" ? ref.ownerAccount : null;
  const affects = owner
    ? all.filter((t) => t.id !== target.id && t.classification.evidence.codeRef?.kind === "global_account" && (t.classification.evidence.codeRef as { ownerAccount: string }).ownerAccount === owner).map((t) => t.id)
    : [];
  return { id: `det-${n}`, target: target.id, channel: upgradeChannel(target), owner, affects };
}

export { channelsOf };

export interface AttestorState {
  pending: Detection[];
}

export interface AttestorStore {
  get(): AttestorState;
  subscribe(l: () => void): () => void;
  upgrade(target: TargetRecord, all: TargetRecord[]): Detection;
  /** Drops a detection once it has been reported. */
  reported(target: string): void;
}

export function createAttestorStore(): AttestorStore {
  let state: AttestorState = { pending: [] };
  let n = 0;
  const listeners = new Set<() => void>();
  const set = (s: AttestorState) => {
    state = s;
    listeners.forEach((l) => l());
  };
  return {
    get: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    upgrade(target, all) {
      if (target.classification.class === "immutable_verified") throw new Error("ARUNA_CANNOT_CHANGE: an immutable_verified target has no upgrade path.");
      const existing = state.pending.find((d) => d.target === target.id);
      if (existing) return existing;
      const d = detectionFor(target, all, ++n);
      set({ pending: [...state.pending, d] });
      return d;
    },
    reported(target) {
      set({ pending: state.pending.filter((d) => d.target !== target) });
    },
  };
}

export const attestorStore = createAttestorStore();
