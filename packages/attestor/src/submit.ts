// Transactions to the registry, signed by the attestor's account key. Testnet only.
import { Account, JsonRpcProvider } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { accountKey } from "./keys.js";
import type { DriftReport } from "./report.js";

export interface Chain {
  report(report: DriftReport, signatureB64: string): Promise<{ id: number; tx: string }>;
  heartbeat(): Promise<string>;
  view<T>(method: string, args: Record<string, unknown>): Promise<T>;
}

export function connect(attestor: string, registry: string, rpcUrl: string): Chain {
  if (!attestor.endsWith(".testnet") || !registry.endsWith(".testnet")) throw new Error("refusing: the attestor runs on testnet only");
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const account = new Account(attestor, provider, accountKey(attestor) as KeyPairString);
  const call = async (methodName: string, args: Record<string, unknown>, tgas: bigint, deposit = 0n) => {
    const res = await account.callFunctionRaw({ contractId: registry, methodName, args, gas: tgas * 10n ** 12n, deposit, waitUntil: "FINAL" });
    const status = res.status as { SuccessValue?: string; Failure?: unknown };
    if (status.Failure !== undefined) throw new Error(`${methodName} failed: ${JSON.stringify(status.Failure)}`);
    const raw = Buffer.from(status.SuccessValue ?? "", "base64").toString();
    return { value: raw ? JSON.parse(raw) : null, tx: res.transaction.hash as string };
  };
  return {
    async report(report, signature) {
      const r = await call("report_drift", { report, signature }, 50n);
      return { id: r.value as number, tx: r.tx };
    },
    async heartbeat() {
      return (await call("heartbeat", {}, 10n)).tx;
    },
    async view<T>(method: string, args: Record<string, unknown>) {
      return (await provider.callFunction({ contractId: registry, method, args })) as T;
    },
  };
}
