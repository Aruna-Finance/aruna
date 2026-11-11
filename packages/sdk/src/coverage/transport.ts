// How the coverage read clients reach the chain. One method, so the keyless implementation below,
// the signing transport of @aruna/sdk/vault and a test double all fit.
import { DEFAULT_ENDPOINTS, type Network } from "@aruna/rpc";
import { ArunaRpcError } from "../vault/transport.js";

export interface ReadTransport {
  view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T>;
}

/** Keyless reads over JSON-RPC, trying each endpoint in turn. Signs nothing. */
export function fetchViewTransport(o: { network?: Network; endpoints?: readonly string[]; fetch?: typeof fetch } = {}): ReadTransport {
  const endpoints = o.endpoints ?? DEFAULT_ENDPOINTS[o.network ?? "testnet"];
  const doFetch = o.fetch ?? fetch;
  return {
    async view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
      const attempts: string[] = [];
      for (const url of endpoints) {
        try {
          const res = await doFetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: "aruna", method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } }),
          });
          const body = await res.json();
          if (body.error) throw new Error(body.error.cause?.name ?? body.error.name ?? "node error");
          // A contract error (no such method, a panic) is a result with `error`, not an RPC error: do not
          // retry it on another endpoint, it would say the same.
          if (typeof body.result?.error === "string") throw new ArunaRpcError(`${contract}.${method}: ${body.result.error}`);
          return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
        } catch (e) {
          if (e instanceof ArunaRpcError) throw e;
          attempts.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      throw new ArunaRpcError(`${contract}.${method}: no endpoint answered (${attempts.join("; ")})`);
    },
  };
}
