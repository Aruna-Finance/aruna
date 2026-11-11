import { describe, expect, it } from "vitest";
import { chooseSource, type IndexerConfig } from "../src/cli.js";

const config: IndexerConfig = { network: "testnet", neardata: "https://testnet.neardata.xyz", start_block: 1, factories: [], contracts: [] };

describe("which block source the CLI uses", () => {
  it("prefers the RPC endpoint when QUICKNODE_RPC_URL is set, and names it without printing the URL", () => {
    const { label } = chooseSource(config, { QUICKNODE_RPC_URL: "https://x.quiknode.pro/secrettoken123/", FASTNEAR_API_KEY: "k" });
    expect(label).toContain("RPC endpoint");
    expect(label).not.toContain("secrettoken123");
  });

  it("falls back to neardata, and says plainly when it has no key", () => {
    expect(chooseSource(config, { FASTNEAR_API_KEY: "k" }).label).toContain("FastNear key");
    expect(chooseSource(config, {}).label).toContain("without a key");
  });

  it("reads 8 blocks at a time from an RPC endpoint, where throughput peaked, and 16 from neardata", () => {
    expect(chooseSource(config, { QUICKNODE_RPC_URL: "https://x.quiknode.pro/secrettoken123/" }).defaultConcurrency).toBe(8);
    expect(chooseSource(config, { FASTNEAR_API_KEY: "k" }).defaultConcurrency).toBe(16);
  });

  it("treats an empty QUICKNODE_RPC_URL as unset", () => {
    expect(chooseSource(config, { QUICKNODE_RPC_URL: "" }).label).toContain("neardata");
  });
});
