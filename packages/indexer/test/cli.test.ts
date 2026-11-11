import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertWritable, chooseSource, type IndexerConfig } from "../src/cli.js";

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

describe("the database directory must be writable", () => {
  it("creates a missing directory and accepts it", () => {
    const root = mkdtempSync(join(tmpdir(), "aruna-db-"));
    expect(() => assertWritable(join(root, "nested", "x.sqlite"))).not.toThrow();
    rmSync(root, { recursive: true });
  });

  // A root user can write anywhere, so this case only means something for any other user.
  it.skipIf(process.getuid?.() === 0)("explains a read-only directory, as a root-owned Railway volume looks to the node user", () => {
    const root = mkdtempSync(join(tmpdir(), "aruna-db-"));
    chmodSync(root, 0o555);
    expect(() => assertWritable(join(root, "x.sqlite"))).toThrow(/RAILWAY_RUN_UID=0/);
    chmodSync(root, 0o755);
    rmSync(root, { recursive: true });
  });
});
