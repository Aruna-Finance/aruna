// The default transport, over near-api-js. Testnet by default.
import { Account, JsonRpcProvider, KeyPair, actions } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { ArunaAuthError, ArunaRpcError, type CallResult, type MigrationTransport } from "./transport.js";

const DEFAULT_RPC = { testnet: "https://rpc.testnet.fastnear.com", mainnet: "https://rpc.mainnet.fastnear.com" } as const;

/**
 * `signerId` signs with `privateKey`: the vault account and an agent's function-call key, or the
 * operator's or owner's own account and key. The key stays in the caller's process.
 */
export function nearApiTransport(o: { signerId: string; privateKey: string; network?: "testnet" | "mainnet"; rpcUrl?: string }): MigrationTransport & { publicKey(): Promise<string> } {
  const provider = new JsonRpcProvider({ url: o.rpcUrl ?? DEFAULT_RPC[o.network ?? "testnet"] });
  const account = new Account(o.signerId, provider, o.privateKey as KeyPairString);
  const isAuthFailure = (m: string) => /panicked|ARUNA_|MethodNameMismatch|ReceiverMismatch|NotEnoughAllowance|RequiresFullAccess|DepositWithFunctionCall|AccessKeyDoesNotExist|InvalidAccessKey/i.test(m);
  async function send(contract: string, acts: ReturnType<typeof actions.functionCall>[]): Promise<CallResult> {
    let res;
    try {
      res = await account.signAndSendTransaction({ receiverId: contract, actions: acts, waitUntil: "FINAL", throwOnFailure: false });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (isAuthFailure(m)) throw new ArunaAuthError(m);
      throw new ArunaRpcError(m);
    }
    const status = res.status as { SuccessValue?: string; Failure?: unknown };
    if (status.Failure !== undefined) throw new ArunaAuthError(JSON.stringify(status.Failure));
    const raw = new TextDecoder().decode(Uint8Array.from(atob(status.SuccessValue ?? ""), (c) => c.charCodeAt(0)));
    return { value: raw ? JSON.parse(raw) : null, tx: res.transaction.hash as string, logs: res.receipts_outcome.flatMap((r) => r.outcome.logs), receipts: res.receipts_outcome.map((r) => ({ executor: r.outcome.executor_id as string, logs: r.outcome.logs })) };
  }
  return {
    signerId: o.signerId,
    async publicKey() {
      return KeyPair.fromString(o.privateKey as KeyPairString).getPublicKey().toString();
    },
    async view<T>(contract: string, method: string, args: Record<string, unknown>) {
      try {
        return (await provider.callFunction({ contractId: contract, method, args })) as T;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (isAuthFailure(m)) throw new ArunaAuthError(m);
        throw new ArunaRpcError(m);
      }
    },
    async call(contract, methodName, args, { depositYocto, tgas }) {
      let res;
      try {
        res = await account.callFunctionRaw({ contractId: contract, methodName, args, deposit: depositYocto, gas: tgas * 10n ** 12n, waitUntil: "FINAL" });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (isAuthFailure(m)) throw new ArunaAuthError(m);
        throw new ArunaRpcError(m);
      }
      const status = res.status as { SuccessValue?: string; Failure?: unknown };
      if (status.Failure !== undefined) throw new ArunaAuthError(JSON.stringify(status.Failure));
      const raw = new TextDecoder().decode(Uint8Array.from(atob(status.SuccessValue ?? ""), (c) => c.charCodeAt(0)));
      return { value: raw ? JSON.parse(raw) : null, tx: res.transaction.hash as string, logs: res.receipts_outcome.flatMap((r) => r.outcome.logs), receipts: res.receipts_outcome.map((r) => ({ executor: r.outcome.executor_id as string, logs: r.outcome.logs })) };
    },
    async callBatch(contract, calls) {
      return send(contract, calls.map((c) => actions.functionCall(c.method, c.args, c.tgas * 10n ** 12n, c.depositYocto)));
    },
    async transfer(receiver, amountYocto) {
      try {
        const res = await account.transfer({ receiverId: receiver, amount: amountYocto });
        return { tx: res.transaction.hash as string };
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw isAuthFailure(m) ? new ArunaAuthError(m) : new ArunaRpcError(m);
      }
    },
    async txStatus(txHash) {
      try {
        const r = await provider.viewTransactionStatus({ txHash, accountId: o.signerId, waitUntil: "FINAL" });
        const failed = (r.receipts_outcome as { outcome: { status: unknown } }[]).some((x) => typeof x.outcome.status === "object" && x.outcome.status !== null && "Failure" in x.outcome.status);
        const st = r.status as { Failure?: unknown } | string;
        return typeof st === "object" && st !== null && "Failure" in st || failed ? "failed" : "success";
      } catch {
        return "unknown";
      }
    },
    async account(id: string) {
      const a = (await provider.viewAccount({ accountId: id })) as unknown as { amount: string; global_contract_hash?: string | null; storage_usage?: number };
      return { amount: String(a.amount), globalContractHash: a.global_contract_hash ?? null, storageUsage: Number(a.storage_usage ?? 0) };
    },
  };
}
