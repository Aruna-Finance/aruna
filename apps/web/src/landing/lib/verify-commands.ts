// Endpoints and request bodies are copied from docs.near.org/api/rpc (providers + contracts pages).
// CORS from a browser origin is NOT stated by those docs: confirm before wiring live lookups.
import type { Network } from "./classifier-types";

export const RPC_ENDPOINT: Record<Network, string> = {
  mainnet: "https://free.rpc.fastnear.com",
  testnet: "https://test.rpc.fastnear.com",
};

export const VERIFY_REQUEST_TYPES = ["view_account", "view_code", "view_access_key_list"] as const;
export type VerifyRequestType = (typeof VERIFY_REQUEST_TYPES)[number];

export function rpcBody(requestType: VerifyRequestType, accountId: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: "dontcare",
    method: "query",
    params: { request_type: requestType, finality: "final", account_id: accountId },
  });
}

/** One curl per check. Single-quote safe: NEAR account ids cannot contain a single quote. */
export function curlFor(requestType: VerifyRequestType, accountId: string, network: Network): string {
  return `curl -s ${RPC_ENDPOINT[network]} -H 'content-type: application/json' -d '${rpcBody(requestType, accountId)}'`;
}

export function isSafeAccountId(id: string): boolean {
  return /^[a-z0-9._-]{2,64}$/.test(id);
}
