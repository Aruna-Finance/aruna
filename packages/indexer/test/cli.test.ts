import { describe, expect, it } from "vitest";
import { chooseSource, ingestForever, loadConfig, main, type IndexerConfig } from "../src/cli.js";
import type { IndexerOptions } from "../src/indexer.js";
import { testStore } from "./helpers.js";

const config: IndexerConfig = { network: "testnet", live_rpc: "https://live.example/rpc", fallback_rpc: "https://fallback.example/rpc", start_block: 1, factories: [], contracts: [] };

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

  it("ignores a FastNear key and the retired source switch: there is no neardata path any more", () => {
    expect(chooseSource(config, { FASTNEAR_API_KEY: "k" }).label).toContain("dRPC");
    expect(chooseSource(config, { FASTNEAR_API_KEY: "k", ARUNA_BLOCK_SOURCE: "neardata" }).label).toContain("dRPC");
    expect(chooseSource(config, { ARUNA_BLOCK_SOURCE: "neardata" }).defaultConcurrency).toBe(8);
  });

  it("treats an empty QUICKNODE_RPC_URL as unset", () => {
    expect(chooseSource(config, { QUICKNODE_RPC_URL: "" }).label).not.toContain("QuickNode");
  });

  it("names the public endpoints in the shipped testnet config", () => {
    const shipped = loadConfig();
    expect(shipped.live_rpc).toBe("https://near-testnet.drpc.org");
    expect(shipped.fallback_rpc).toBe("https://archival-rpc.testnet.near.org");
  });

  it("starts at the creation of factory2 and follows only the v2 contracts", () => {
    const shipped = loadConfig();
    expect(shipped.start_block).toBe(277103406);
    expect(shipped.factories).toEqual(["factory2.arunafi.testnet"]);
    expect(shipped.contracts).toEqual(["registry2.arunafi.testnet", "pool2.arunafi.testnet"]);
    expect("neardata" in shipped).toBe(false);
  });
});

describe("serve keeps one source and one store across ingest restarts", () => {
  const seeds = { factories: [], contracts: [] };

  it("retries a failed run with the same source and store, so what it learned survives", async () => {
    const { source } = chooseSource(config, {});
    const store = await testStore();
    const seen: unknown[] = [];
    let opened = 0;
    let runs = 0;
    const run = async (o: IndexerOptions) => {
      seen.push([o.source, o.store]);
      if (++runs === 1) throw new Error("block answered HTTP 429");
      throw new Error("stop");
    };
    let waits = 0;
    const wait = async () => {
      if (++waits === 2) throw new Error("done");
    };
    const open = async () => {
      opened++;
      return store;
    };
    await expect(ingestForever({ open, source, seeds, startBlock: 1 }, run, wait)).rejects.toThrow("done");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual([source, store]);
    expect(seen[1]).toEqual([source, store]);
    expect(opened).toBe(1);
  });

  it("opens the store again on the next try when the database is down, and does not run ingest until it is open", async () => {
    const { source } = chooseSource(config, {});
    const store = await testStore();
    let opens = 0;
    const open = async () => {
      if (++opens === 1) throw new Error("the database is down");
      return store;
    };
    const ran: unknown[] = [];
    const run = async (o: IndexerOptions) => {
      ran.push(o.store);
      throw new Error("stop");
    };
    let waits = 0;
    const wait = async () => {
      if (++waits === 3) throw new Error("done");
    };
    const onOpen: unknown[] = [];
    await expect(ingestForever({ open, onOpen: (s) => onOpen.push(s), source, seeds, startBlock: 1 }, run, wait)).rejects.toThrow("done");
    expect(opens).toBe(2);
    expect(onOpen).toEqual([store]);
    expect(ran.length).toBeGreaterThan(0);
    expect(ran.every((s) => s === store)).toBe(true);
  });
});

describe("the database is required", () => {
  it("fails the command, naming DATABASE_URL, when it is not set", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(main(["export"])).rejects.toThrow(/DATABASE_URL/);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});
