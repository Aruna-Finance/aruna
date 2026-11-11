// The default transport, over near-api-js. Testnet by default.
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { ArunaAuthError, ArunaRpcError, type VaultTransport } from "./transport.js";

const DEFAULT_RPC = { testnet: "https://rpc.testnet.fastnear.com", mainnet: "https://rpc.mainnet.fastnear.com" } as const;

/**
 * `signerId` signs with `privateKey`: the vault account and an agent's function-call key, or the
 * operator's or owner's own account and key. The key stays in the caller's process.
 */
export function nearApiTransport(o: { signerId: string; privateKey: string; network?: "testnet" | "mainnet"; rpcUrl?: string }): VaultTransport & { publicKey(): Promise<string> } {
  const provider = new JsonRpcProvider({ url: o.rpcUrl ?? DEFAULT_RPC[o.network ?? "testnet"] });
  const account = new Account(o.signerId, provider, o.privateKey as KeyPairString);
  const isAuthFailure = (m: string) => /panicked|ARUNA_|MethodNameMismatch|ReceiverMismatch|NotEnoughAllowance|RequiresFullAccess|DepositWithFunctionCall|AccessKeyDoesNotExist|InvalidAccessKey/i.test(m);
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
    async account(id: string) {
      const a = (await provider.viewAccount({ accountId: id })) as unknown as { amount: string; global_contract_hash?: string | null };
      return { amount: String(a.amount), globalContractHash: a.global_contract_hash ?? null };
    },
  };
}
