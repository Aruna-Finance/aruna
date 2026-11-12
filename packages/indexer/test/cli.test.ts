import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertWritable, chooseSource, ingestForever, loadConfig, type IndexerConfig } from "../src/cli.js";
import type { IndexerOptions } from "../src/indexer.js";

const config: IndexerConfig = { network: "testnet", live_rpc: "https://live.example/rpc", fallback_rpc: "https://fallback.example/rpc", neardata: "https://testnet.neardata.xyz", start_block: 1, factories: [], contracts: [] };

describe("which block source the CLI uses", () => {
  it("needs no environment at all: dRPC, with NEAR archival for older blocks", () => {
    const { label, defaultConcurrency } = chooseSource(config, {});
    expect(label).toBe("dRPC; NEAR archival for older blocks and as fallback");
    expect(defaultConcurrency).toBe(8);
  });

  it("adds QuickNode as the archive when QUICKNODE_RPC_URL is set, and names it without printing the URL", () => {
    const { label } = chooseSource(config, { QUICKNODE_RPC_URL: "https://x.quiknode.pro/secrettoken123/" });
    expect(label).toContain("QuickNode to dRPC's edge");
    expect(label).not.toContain("secrettoken123");
    expect(label).not.toContain("quiknode.pro");
  });

  it("ignores a FastNear key unless neardata is asked for", () => {
    expect(chooseSource(config, { FASTNEAR_API_KEY: "k" }).label).toContain("dRPC");
    expect(chooseSource(config, { FASTNEAR_API_KEY: "k", ARUNA_BLOCK_SOURCE: "neardata" }).label).toContain("FastNear key");
    expect(chooseSource(config, { ARUNA_BLOCK_SOURCE: "neardata" }).label).toContain("without a key");
    expect(chooseSource(config, { ARUNA_BLOCK_SOURCE: "neardata" }).defaultConcurrency).toBe(16);
  });

  it("treats an empty QUICKNODE_RPC_URL as unset", () => {
    expect(chooseSource(config, { QUICKNODE_RPC_URL: "" }).label).not.toContain("QuickNode");
  });

  it("names the public endpoints in the shipped testnet config", () => {
    const shipped = loadConfig();
    expect(shipped.live_rpc).toBe("https://near-testnet.drpc.org");
    expect(shipped.fallback_rpc).toBe("https://archival-rpc.testnet.near.org");
  });
});

describe("serve keeps one source across ingest restarts", () => {
  it("retries a failed run with the same source, so what it learned survives", async () => {
    const { source } = chooseSource(config, {});
    const seen: unknown[] = [];
    let runs = 0;
    const run = async (o: IndexerOptions) => {
      seen.push(o.source);
      if (++runs === 1) throw new Error("block answered HTTP 429");
      throw new Error("stop");
    };
    let waits = 0;
    const wait = async () => {
      if (++waits === 2) throw new Error("done");
    };
    await expect(ingestForever({ store: undefined as never, source, seeds: { factories: [], contracts: [] }, startBlock: 1 }, run, wait)).rejects.toThrow("done");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
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
