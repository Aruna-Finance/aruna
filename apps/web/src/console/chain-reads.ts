import type { ChainReads } from "./wallet-transport";

// Reads from the public testnet RPC for the console: contract views and account balances. Read-only, no keys.
// The vault page reads vault state through @aruna/sdk readVault; this is for the factory, the registry and balances.

const RPC = "https://rpc.testnet.fastnear.com";

type RpcBody = { result?: Record<string, unknown>; error?: { cause?: { name?: string }; data?: unknown; message?: string } };

export interface TestnetReads extends ChainReads {
  account(id: string): Promise<{ amount: string; globalContractHash: string | null; storageUsage: number }>;
  /** yoctoNEAR, or null when the account does not exist. */
  balance(id: string): Promise<bigint | null>;
  /** The height of the latest final block. */
  headBlock(): Promise<number>;
}

export function createTestnetReads(doFetch: typeof fetch = (...a) => fetch(...a), url = RPC): TestnetReads {
  async function rpc(method: string, params: unknown): Promise<RpcBody> {
    const res = await doFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (!res.ok) throw new Error(`testnet RPC answered ${res.status}`);
    return (await res.json()) as RpcBody;
  }
  const unknownAccount = (b: RpcBody) => b.error?.cause?.name === "UNKNOWN_ACCOUNT";

  return {
    async view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
      const b = await rpc("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) });
      if (b.error) throw new Error(`${contract}.${method}: ${b.error.message ?? JSON.stringify(b.error.data ?? b.error)}`);
      const r = b.result as { result?: number[]; error?: string } | undefined;
      if (!r || typeof r.error === "string") throw new Error(`${contract}.${method}: ${r?.error ?? "no result"}`);
      return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result ?? []))) as T;
    },
    async account(id: string) {
      const b = await rpc("query", { request_type: "view_account", finality: "final", account_id: id });
      if (b.error || !b.result) throw new Error(unknownAccount(b) ? `${id} does not exist` : `could not read ${id}`);
      return { amount: String(b.result.amount), globalContractHash: (b.result.global_contract_hash as string | null | undefined) ?? null, storageUsage: Number(b.result.storage_usage ?? 0) };
    },
    async headBlock() {
      const b = await rpc("block", { finality: "final" });
      const h = (b.result as { header?: { height?: number } } | undefined)?.header?.height;
      if (b.error || typeof h !== "number") throw new Error("could not read the latest block");
      return h;
    },
    async balance(id: string) {
      const b = await rpc("query", { request_type: "view_account", finality: "final", account_id: id });
      if (unknownAccount(b)) return null;
      if (b.error || !b.result) throw new Error(`could not read ${id}`);
      return BigInt(String(b.result.amount));
    },
  };
}
