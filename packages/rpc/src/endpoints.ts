export type Network = "mainnet" | "testnet";

/**
 * Public JSON-RPC endpoints, tried in order. Each was checked on 9 November 2026: `status` answers
 * with the right chain_id at protocol 88, and a browser CORS preflight returns
 * `access-control-allow-origin: *`. Re-check before changing the list.
 */
export const DEFAULT_ENDPOINTS: Readonly<Record<Network, readonly string[]>> = {
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
  testnet: ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
};
