import { ArunaAuthError, ArunaRpcError } from "@aruna/sdk/vault";

// What the transaction dialog shows after the user confirms. Pure, so every transition is testable without a wallet.
// A policy refusal is an outcome with its reason code, not an error (FRONTEND non-negotiable 4, CLAUDE.md rule 9).
// An authorization failure or a failed send is a failure.

/** The user closed the wallet prompt, or the preview was declined. Not an error. */
export class WalletCancelledError extends Error {
  constructor(message = "The wallet prompt was closed.") {
    super(message);
    this.name = "WalletCancelledError";
  }
}

export type TxPhase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "confirmed"; hash: string | null }
  | { kind: "refused"; reason: string; targetClass: string | null; hash: string | null }
  | { kind: "failed"; message: string; reason: string | null; sent: boolean }
  | { kind: "cancelled" };

/** Testnet only (CLAUDE.md rule 3). The link is built from the hash alone. */
export const explorerTxUrl = (hash: string) => `https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`;

/** `ARUNA_CLASS_STALE` out of a panic message, or null. Does not throw on an unknown code: the failure is still shown. */
export function reasonIn(message: string): string | null {
  return /ARUNA_[A-Z_]+/.exec(message)?.[0] ?? null;
}

const hashOf = (r: unknown): string | null => {
  if (typeof r !== "object" || r === null) return null;
  const o = r as { tx?: unknown; hash?: unknown };
  if (typeof o.tx === "string") return o.tx;
  if (typeof o.hash === "string") return o.hash;
  return null;
};

/** Maps what an SDK call returned, or threw, to the phase the dialog shows. */
export function phaseOf(result: unknown): TxPhase {
  if (typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === false) {
    const r = result as { reason?: unknown; targetClass?: unknown };
    return {
      kind: "refused",
      reason: typeof r.reason === "string" ? r.reason : "UNKNOWN",
      targetClass: typeof r.targetClass === "string" ? r.targetClass : null,
      hash: hashOf(result),
    };
  }
  return { kind: "confirmed", hash: hashOf(result) };
}

export function phaseOfError(e: unknown): TxPhase {
  if (e instanceof WalletCancelledError) return { kind: "cancelled" };
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof ArunaAuthError) return { kind: "failed", message, reason: reasonIn(message), sent: true };
  // The call could not be sent or its result read: nothing is known about whether it ran.
  if (e instanceof ArunaRpcError) return { kind: "failed", message, reason: null, sent: false };
  return { kind: "failed", message, reason: reasonIn(message), sent: false };
}

/**
 * Runs the action the user confirmed and reports each phase. A function that returns nothing (a mock action)
 * is confirmed straight away, so existing screens behave as before.
 */
export async function runTx(fn: () => Promise<unknown> | unknown, set: (p: TxPhase) => void): Promise<TxPhase> {
  set({ kind: "signing" });
  let end: TxPhase;
  try {
    end = phaseOf(await fn());
  } catch (e) {
    end = phaseOfError(e);
  }
  set(end);
  return end;
}
