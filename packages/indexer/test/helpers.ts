import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BlockSource, NeardataBlock } from "../src/ingest/neardata.js";

const DIR = join(import.meta.dirname, "fixtures", "blocks");

/** Recorded neardata blocks, trimmed to receipts executed by *.arunafi.testnet (fixtures/README.md). */
export function recordedBlocks(): Map<number, NeardataBlock> {
  const m = new Map<number, NeardataBlock>();
  for (const f of readdirSync(DIR)) if (f.endsWith(".json")) m.set(Number(f.replace(".json", "")), JSON.parse(readFileSync(join(DIR, f), "utf8")));
  return m;
}

export const FIRST = 277068623;
export const LAST = 277069048;

/** A deep copy, so a test can alter a recorded block without touching the others. */
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Answers from `blocks`; any other height in range is an empty block, as most testnet blocks are for us. */
export function memorySource(blocks: Map<number, NeardataBlock>, opts: { head?: number; failAt?: number } = {}): BlockSource & { calls: number[] } {
  const calls: number[] = [];
  let failed = false;
  return {
    calls,
    async block(h) {
      calls.push(h);
      if (opts.failAt === h && !failed) {
        failed = true;
        throw new Error(`simulated crash at ${h}`);
      }
      return blocks.get(h) ?? { block: { header: { height: h, hash: `empty-${h}`, timestamp_nanosec: String(1794314403283356753n + BigInt(h - FIRST) * 1_000_000_000n) } }, shards: [] };
    },
    async finalHeight() {
      return opts.head ?? LAST;
    },
  };
}

export const SEEDS = {
  factories: ["factory.arunafi.testnet", "factory2.arunafi.testnet"],
  contracts: ["registry.arunafi.testnet", "registry2.arunafi.testnet", "pool.arunafi.testnet", "pool2.arunafi.testnet"],
};

/** An EVENT_JSON log line as a contract would write it. */
export const eventLine = (event: string, data: unknown) => `EVENT_JSON:${JSON.stringify({ standard: "aruna", version: "1.0.0", event, data: [data] })}`;
