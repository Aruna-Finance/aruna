#!/usr/bin/env node
// aruna-indexer — reads Aruna's testnet events from the public block archive into one SQLite file.
// Holds no keys and sends no transactions (R5).

import { accessSync, constants, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runIndexer, type IndexerOptions } from "./indexer.js";
import { neardataSource, type BlockSource } from "./ingest/neardata.js";
import { routedSource } from "./ingest/routed.js";
import { rpcSource } from "./ingest/rpc.js";
import { startServer } from "./server.js";
import { sleep } from "./sleep.js";
import { openStore } from "./store.js";

const USAGE = `aruna-indexer — Aruna's testnet history, rebuilt from chain data alone.

Usage:
  aruna-indexer index   [--db <file>] [--config <file>] [--stop-at <block>] [--follow] [--concurrency N]
      Read blocks from the committed cursor (or the config's start block) to the head, or to --stop-at.
      --follow keeps reading new blocks as they become final.
  aruna-indexer rebuild [--db <file>] [--config <file>] [--stop-at <block>] [--concurrency N]
      Delete the store and read everything again from the start block. Takes hours from scratch.
  aruna-indexer serve   [--db <file>] [--config <file>] [--port 8080] [--concurrency N]
      Serve the read API and keep indexing new blocks in the same process. A failed read is retried.
  aruna-indexer export  [--db <file>] [--out <file>]
      Write every derived table as canonical JSON. Two stores built from the same blocks export the same bytes.

Environment: ARUNA_INDEXER_DB (default ./aruna-indexer.sqlite) and ARUNA_INDEXER_CONFIG.
Block sources, chosen per height (no key needed):
  live (config live_rpc)          dRPC, free. Holds about the last two days of blocks; reads them and the head.
  QUICKNODE_RPC_URL               optional paid archive (the URL carries the token, so it is a secret). Reads only
                                  the heights live no longer holds, then is never called again. 50 credits a call.
  fallback (config fallback_rpc)  NEAR's archival RPC, free and slow (about 19 calls a minute). Reads what the
                                  others cannot; a failing endpoint is benched for 5 minutes.
  ARUNA_BLOCK_SOURCE=neardata     the older neardata path instead (testnet.neardata.xyz, FASTNEAR_API_KEY when set).
--concurrency is how many blocks are read at a time. The default is 8 for the RPC sources and 16 for neardata.`;

export interface IndexerConfig {
  network: string;
  /** A free RPC endpoint that prunes old blocks, for recent blocks and the head. */
  live_rpc: string;
  /** A free archival RPC endpoint, slow, for whatever the others cannot read. */
  fallback_rpc: string;
  neardata: string;
  start_block: number;
  factories: string[];
  contracts: string[];
}

export function loadConfig(path?: string): IndexerConfig {
  const file = path ?? process.env.ARUNA_INDEXER_CONFIG ?? new URL("../config/testnet.json", import.meta.url);
  const c = JSON.parse(readFileSync(file, "utf8")) as IndexerConfig;
  if (c.network !== "testnet") throw new Error(`the indexer runs on testnet only, config says ${c.network}`);
  return c;
}

/** Blocks read at a time from a QuickNode testnet endpoint. Measured on 11 November 2026: 12.5 blocks/s at 8, and slower above
 * it (10.6 at 16, 5.5 at 48) because the endpoint rate-limits and the retries cost more than the parallelism gains. */
const RPC_CONCURRENCY = 8;
/** A QuickNode trial rate-limits per second (15 requests/s on the free plan) and a block costs several requests, so the
 * archive lane starts lower than RPC_CONCURRENCY; QUICKNODE_CONCURRENCY overrides it. */
const ARCHIVE_CONCURRENCY = 3;
/** dRPC's free tier: 733 calls a minute at 4 in flight on 12 November 2026, with an occasional 429 the retries absorb. */
const LIVE_CONCURRENCY = 4;
/** NEAR's archival RPC: about 19 calls a minute one at a time, with no 429, on 12 November 2026. */
const FALLBACK_CONCURRENCY = 1;
const NEARDATA_CONCURRENCY = 16;

export function chooseSource(config: IndexerConfig, env: NodeJS.ProcessEnv = process.env): { source: BlockSource<unknown>; label: string; defaultConcurrency: number } {
  if (env.ARUNA_BLOCK_SOURCE === "neardata") {
    const apiKey = env.FASTNEAR_API_KEY || undefined;
    return {
      source: neardataSource({ baseUrl: config.neardata, apiKey }),
      label: apiKey ? "neardata with a FastNear key" : "neardata without a key (30 blocks a minute)",
      defaultConcurrency: NEARDATA_CONCURRENCY,
    };
  }
  if (env.FASTNEAR_API_KEY) console.error("FASTNEAR_API_KEY is set but not used: the RPC sources need no key (set ARUNA_BLOCK_SOURCE=neardata to use it)");
  const quicknode = env.QUICKNODE_RPC_URL || undefined;
  const source = routedSource({
    archive: quicknode ? { source: rpcSource({ url: quicknode }), label: "QuickNode", concurrency: Number(env.QUICKNODE_CONCURRENCY) || ARCHIVE_CONCURRENCY } : undefined,
    live: { source: rpcSource({ url: config.live_rpc, proveSkips: true }), label: "dRPC", concurrency: LIVE_CONCURRENCY },
    // The fallback can trail the head that dRPC reported, and answers UNKNOWN_BLOCK for a final block it has not
    // synced yet, so it proves skips too. QuickNode reads only deep history, where UNKNOWN_BLOCK is a real skip.
    fallback: { source: rpcSource({ url: config.fallback_rpc, proveSkips: true }), label: "NEAR archival", concurrency: FALLBACK_CONCURRENCY },
    onSwitch: (label) => console.error(`block source now: ${label}`),
  });
  const label = quicknode ? "QuickNode to dRPC's edge, then dRPC; NEAR archival as fallback" : "dRPC; NEAR archival for older blocks and as fallback";
  return { source, label, defaultConcurrency: RPC_CONCURRENCY };
}

/**
 * Keeps ingest running in `serve`: a failed run is retried after 10 s with the same options, so the source keeps
 * what it learned (the edge latch, benched endpoints) across retries (plan KTD3, KTD4).
 */
export async function ingestForever(options: IndexerOptions, run: typeof runIndexer = runIndexer, wait: (ms: number) => Promise<unknown> = sleep): Promise<never> {
  for (;;) {
    try {
      await run({ ...options, follow: true });
    } catch (e) {
      console.error(`ingest stopped: ${e instanceof Error ? e.message : String(e)}; resuming in 10 s`);
      await wait(10_000);
    }
  }
}

function ingestOptions(config: IndexerConfig, store: IndexerOptions["store"], concurrency: string | undefined): IndexerOptions {
  const { source, label, defaultConcurrency } = chooseSource(config);
  console.error(`block source: ${label}`);
  return {
    store,
    source,
    seeds: { factories: config.factories, contracts: config.contracts },
    startBlock: config.start_block,
    concurrency: concurrency ? Number(concurrency) : defaultConcurrency,
  };
}

/** A volume is often mounted root-owned, and the container runs as an unprivileged user: fail with the way out, not with SQLite's "unable to open database file". */
export function assertWritable(dbPath: string): void {
  const dir = dirname(resolve(dbPath));
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error(
      `cannot write to ${dir}, where the indexer keeps its database. A volume is often mounted root-owned: on Railway set RAILWAY_RUN_UID=0 on the service; elsewhere make the directory writable for the user the process runs as.`,
    );
  }
}

function removeStore(db: string) {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(db + suffix, { force: true });
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      db: { type: "string" },
      config: { type: "string" },
      "stop-at": { type: "string" },
      follow: { type: "boolean", default: false },
      concurrency: { type: "string" },
      out: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
    },
  });
  const dbPath = values.db ?? process.env.ARUNA_INDEXER_DB ?? "aruna-indexer.sqlite";

  if (cmd === "export") {
    const store = openStore(dbPath);
    const json = store.export();
    store.close();
    if (values.out) await writeFile(values.out, json + "\n");
    else process.stdout.write(json + "\n");
    return 0;
  }

  if (cmd === "serve") {
    const config = loadConfig(values.config);
    assertWritable(dbPath);
    const store = openStore(dbPath);
    const port = Number(values.port ?? process.env.PORT ?? 8080);
    await startServer({ store, port, host: values.host });
    console.error(`serving on :${port}, store ${dbPath}`);
    await ingestForever(ingestOptions(config, store, values.concurrency));
  }

  if (cmd !== "index" && cmd !== "rebuild") {
    console.error(`unknown command ${cmd}\n\n${USAGE}`);
    return 1;
  }
  const config = loadConfig(values.config);
  if (cmd === "rebuild") removeStore(dbPath);
  assertWritable(dbPath);
  const store = openStore(dbPath);
  const started = Date.now();
  let lastLog = 0;
  await runIndexer({
    ...ingestOptions(config, store, values.concurrency),
    stopAt: values["stop-at"] ? Number(values["stop-at"]) : undefined,
    follow: values.follow,
    onProgress: ({ block, head }) => {
      if (Date.now() - lastLog < 10_000 && block < head) return;
      lastLog = Date.now();
      console.error(`indexed through ${block} of ${head} (${Math.round((Date.now() - started) / 1000)}s)`);
    },
  });
  const h = store.health();
  console.error(`done: last indexed block ${h.last_indexed_block}, unparsed events ${h.unparsed_events}`);
  store.close();
  return 0;
}

// The bin is usually reached through a symlink (node_modules/.bin, a global install), so compare real paths.
const isMain = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
