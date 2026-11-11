import { ArunaAuthError, ArunaRpcError, type CallResult, type VaultTransport } from "@aruna/sdk/vault";
import { WalletCancelledError } from "./tx-status";

// A VaultTransport over the connected wallet (plan U4, KTD6). OwnerVault, OperatorVault and the coverage clients
// are used unchanged on top of it. It only ever signs on testnet (R12), and it shows the user what will be signed
// before the wallet opens (R13). The mapping from the wallet's outcome to CallResult follows nearApiTransport in
// packages/sdk/src/vault/near-transport.ts.

/** The part of the wallet this file uses. Structural, so tests need no wallet library. */
export interface WalletLike {
  signAndSendTransaction(p: {
    receiverId: string;
    actions: { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }[];
  }): Promise<unknown>;
}

export interface CallPreview {
  signer: string;
  receiver: string;
  method: string;
  args: Record<string, unknown>;
  /** yoctoNEAR as a decimal string. */
  depositYocto: string;
  gas: string;
}

export interface ChainReads {
  view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T>;
  account(id: string): Promise<{ amount: string; globalContractHash: string | null }>;
}

export interface WalletTransportOptions extends ChainReads {
  wallet: WalletLike;
  /** The connected account. It signs, as owner or operator. */
  signerId: string;
  /** Anything but "testnet" throws before any prompt. */
  network?: string;
  /** Shown before the wallet opens. Resolve false to decline: nothing is sent. */
  confirm?: (p: CallPreview) => Promise<boolean> | boolean;
}

// Same patterns as nearApiTransport's isAuthFailure. If the SDK exports it, import it instead.
const AUTH_FAILURE =
  /panicked|ARUNA_|MethodNameMismatch|ReceiverMismatch|NotEnoughAllowance|RequiresFullAccess|DepositWithFunctionCall|AccessKeyDoesNotExist|InvalidAccessKey/i;
const CANCELLED = /cancel|clos|reject|abort|denied|declin/i;

export function createWalletTransport(o: WalletTransportOptions): VaultTransport {
  if ((o.network ?? "testnet") !== "testnet") {
    throw new Error("The console signs on testnet only. Refusing to build a signing transport for another network.");
  }
  return {
    signerId: o.signerId,
    view: o.view,
    account: o.account,
    async call(contract, method, args, { depositYocto, tgas }) {
      const preview: CallPreview = {
        signer: o.signerId,
        receiver: contract,
        method,
        args,
        depositYocto: depositYocto.toString(),
        gas: (tgas * 10n ** 12n).toString(),
      };
      if (o.confirm && !(await o.confirm(preview))) throw new WalletCancelledError("You declined the transaction.");

      let outcome: unknown;
      try {
        outcome = await o.wallet.signAndSendTransaction({
          receiverId: contract,
          actions: [{ type: "FunctionCall", params: { methodName: method, args, gas: preview.gas, deposit: preview.depositYocto } }],
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (CANCELLED.test(m)) throw new WalletCancelledError(m);
        if (AUTH_FAILURE.test(m)) throw new ArunaAuthError(m);
        throw new ArunaRpcError(m);
      }
      return toCallResult(outcome);
    },
  };
}

interface Outcome {
  status?: { SuccessValue?: string; Failure?: unknown };
  transaction?: { hash?: string };
  receipts_outcome?: { outcome: { executor_id: string; logs: string[] } }[];
}

/** Final execution outcome from the wallet to the SDK's CallResult. */
export function toCallResult(outcome: unknown): CallResult {
  const o = (outcome ?? {}) as Outcome;
  if (o.status?.Failure !== undefined) throw new ArunaAuthError(JSON.stringify(o.status.Failure));
  const hash = o.transaction?.hash;
  if (typeof hash !== "string") throw new ArunaRpcError("The wallet returned no transaction hash, so the result cannot be trusted.");
  const raw = o.status?.SuccessValue ? new TextDecoder().decode(Uint8Array.from(atob(o.status.SuccessValue), (c) => c.charCodeAt(0))) : "";
  const receipts = (o.receipts_outcome ?? []).map((r) => ({ executor: r.outcome.executor_id, logs: r.outcome.logs }));
  return { value: raw ? JSON.parse(raw) : null, tx: hash, logs: receipts.flatMap((r) => r.logs), receipts };
}
