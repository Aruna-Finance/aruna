// How the vault clients reach the chain. Injected, so the clients are testable and a caller can
// bring their own signer. `nearApiTransport` (near-transport.ts) is the default, over near-api-js.

export interface CallResult {
  /** The decoded JSON return value; null for none. */
  value: unknown;
  tx: string;
  /** Logs of every receipt in the outcome, in order: NEP-297 events from callbacks appear here, not in `value`. */
  logs?: readonly string[];
  /** The same logs by the contract that executed the receipt. Events are only trusted from the contract they belong to. */
  receipts?: readonly { executor: string; logs: readonly string[] }[];
}

export interface VaultTransport {
  /** The account that signs calls: the vault itself for an agent key, or the operator/owner. */
  readonly signerId: string;
  view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T>;
  /** Rejects with ArunaAuthError when the contract panics or the network refuses the key, and with
   * ArunaRpcError when the call could not be sent or read. */
  call(contract: string, method: string, args: Record<string, unknown>, opts: { depositYocto: bigint; tgas: bigint }): Promise<CallResult>;
  /** view_account; `globalContractHash` is set for an account running a global contract by hash. */
  account(id: string): Promise<{ amount: string; globalContractHash: string | null }>;
}

/**
 * What a migration needs beyond the vault clients (plan U15): sending NEAR, several calls in ONE transaction
 * (a paused agent is added and paused together), a transaction's outcome by hash, and the storage a
 * vault uses. `nearApiTransport` implements it. A wallet transport can add these when the console
 * migrates (U16); until then it is refused for a migration, not guessed at.
 */
export interface MigrationTransport extends VaultTransport {
  account(id: string): Promise<{ amount: string; globalContractHash: string | null; storageUsage: number }>;
  /** Sends NEAR from the signer to `receiver`. */
  transfer(receiver: string, amountYocto: bigint): Promise<{ tx: string }>;
  /** Function calls to one contract, in one transaction: all happen or none. */
  callBatch(contract: string, calls: { method: string; args: Record<string, unknown>; depositYocto: bigint; tgas: bigint }[]): Promise<CallResult>;
  /** Whether a transaction (and every receipt it spawned) succeeded. "unknown" when the node cannot say. */
  txStatus(txHash: string): Promise<"success" | "failed" | "unknown">;
}

/** An authorization failure: a panic in the contract, or the network refusing the key's permission.
 * Nothing persisted. Not a policy refusal: those resolve with `{ ok: false }` (docs/SDK.md). */
export class ArunaAuthError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "ArunaAuthError";
  }
}

/** The call could not be sent, or its result read. Nothing is known about whether it ran. */
export class ArunaRpcError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "ArunaRpcError";
  }
}

/** The vault runs a code hash this SDK does not know, or lacks a method the call needs. */
export class VaultVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultVersionError";
  }
}
