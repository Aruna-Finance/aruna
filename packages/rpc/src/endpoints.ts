export type Network = "mainnet" | "testnet";

/**
 * Public JSON-RPC endpoints, tried in order. Each was checked (FastNEAR on 9 November 2026, drpc and
 * intea on 10 November): `status` answers with the right chain_id at protocol 88,
 * `query` returns the shapes the reader maps, and responses carry `access-control-allow-origin: *`.
 * rpc.{mainnet,testnet}.near.org are deprecated and answer -429 with a deprecation notice (checked
 * 10 November 2026), so they are not listed.
 * Re-check before changing the list; `pnpm test` with ARUNA_LIVE=1 checks every entry.
 */
export const DEFAULT_ENDPOINTS: Readonly<Record<Network, readonly string[]>> = {
  mainnet: [
    "https://rpc.mainnet.fastnear.com",
    "https://free.rpc.fastnear.com",
    "https://near.drpc.org",
    "https://rpc.intea.rs",
  ],
  testnet: ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com"],
};
