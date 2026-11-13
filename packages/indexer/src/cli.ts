#!/usr/bin/env node
// aruna-indexer — reads Aruna's testnet events from public RPC endpoints into one Postgres database.
// Holds no keys and sends no transactions (R5).

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { connectFromEnv, databaseHost } from "./db.js";
import { runIndexer, type IndexerOptions } from "./indexer.js";
import type { BlockSource } from "./ingest/blocks.js";
import { NEARDATA_TESTNET, neardataSource } from "./ingest/neardata.js";
import { routedSource, type Lane } from "./ingest/routed.js";
import { rpcSource } from "./ingest/rpc.js";
import { startServer } from "./server.js";
import { sleep } from "./sleep.js";
import { openStore, type Store } from "./store.js";

const USAGE = `aruna-indexer — Aruna's testnet history, rebuilt from chain data alone.

Usage:
  aruna-indexer index   [--config <file>] [--stop-at <block>] [--follow] [--concurrency N]
      Read blocks from the committed cursor (or the config's start block) to the head, or to --stop-at.
      --follow keeps reading new blocks as they become final.
  aruna-indexer rebuild [--config <file>] [--stop-at <block>] [--concurrency N]
      Empty every table in the database and read everything again from the start block.
  aruna-indexer serve   [--config <file>] [--port 8080] [--concurrency N]
      Serve the read API and keep indexing new blocks in the same process. A failed read is retried.
  aruna-indexer export  [--out <file>]
      Write every derived table as canonical JSON. Two stores built from the same blocks export the same bytes.

Environment:
  DATABASE_URL                    required: the Postgres database, as the Supabase Session pooler URI (a secret).
  ARUNA_INDEXER_CONFIG            optional: a config file other than the one shipped.
Block sources, chosen per height (no key needed):
  live (config live_rpc)          dRPC, free. Holds about the last two days of blocks; reads them and the head.
  FASTNEAR_API_KEY                optional archive: testnet.neardata.xyz with this FastNear key (a secret, sent only
                                  as a Bearer header). Reads only the heights live no longer holds, then is never
                                  called again. With QUICKNODE_RPC_URL also set, QuickNode reads what neardata fails to.
  QUICKNODE_RPC_URL               optional paid archive (the URL carries the token, so it is a secret). Reads only
                                  the heights live no longer holds, then is never called again. 50 credits a call.
  QUICKNODE_CONCURRENCY           optional: blocks read at once from QuickNode (default 3).
  fallback (config fallback_rpc)  NEAR's archival RPC, free and slow (about 19 calls a minute). Reads what the
                                  others cannot; a failing endpoint is benched for 5 minutes.
--concurrency is how many blocks are read at a time (default 8).`;

export interface IndexerConfig {
  network: string;
  /** A free RPC endpoint that prunes old blocks, for recent blocks and the head. */
  live_rpc: string;
  /** A free archival RPC endpoint, slow, for whatever the others cannot read. */
  fallback_rpc: string;
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
/** neardata with a FastNear key: one window's worth of blocks at once, so the archive never holds a window up (plan KTD2). */
const NEARDATA_CONCURRENCY = 8;

export function chooseSource(config: IndexerConfig, env: NodeJS.ProcessEnv = process.env): { source: BlockSource<unknown>; label: string; defaultConcurrency: number } {
  const fastnearKey = env.FASTNEAR_API_KEY || undefined;
  const quicknodeUrl = env.QUICKNODE_RPC_URL || undefined;
  const quicknode: Lane<unknown> | undefined = quicknodeUrl
    ? { source: rpcSource({ url: quicknodeUrl }), label: "QuickNode", concurrency: Number(env.QUICKNODE_CONCURRENCY) || ARCHIVE_CONCURRENCY }
    : undefined;
  const neardata: Lane<unknown> | undefined = fastnearKey
    ? { source: neardataSource({ baseUrl: NEARDATA_TESTNET, apiKey: fastnearKey }) as BlockSource<unknown>, label: "neardata", concurrency: NEARDATA_CONCURRENCY }
    : undefined;
  // neardata, when keyed, is the archive and QuickNode its backup; otherwise QuickNode alone is the archive.
  const archive = neardata ?? quicknode;
  const archiveBackup = neardata ? quicknode : undefined;
  const source = routedSource<unknown>({
    archive,
    archiveBackup,
    live: { source: rpcSource({ url: config.live_rpc, proveSkips: true }), label: "dRPC", concurrency: LIVE_CONCURRENCY },
    // The fallback can trail the head that dRPC reported, and answers UNKNOWN_BLOCK for a final block it has not
    // synced yet, so it proves skips too. The archives read only deep history, where a missing block is a real skip.
    fallback: { source: rpcSource({ url: config.fallback_rpc, proveSkips: true }), label: "NEAR archival", concurrency: FALLBACK_CONCURRENCY },
    onSwitch: (label) => console.error(`block source now: ${label}`),
  });
  const label = archive
    ? `${archive.label}${archiveBackup ? ` (${archiveBackup.label} as its backup)` : ""} to dRPC's edge, then dRPC; NEAR archival as fallback`
    : "dRPC; NEAR archival for older blocks and as fallback";
  return { source, label, defaultConcurrency: RPC_CONCURRENCY };
}

/**
 * Keeps ingest running in `serve`: the store is opened inside the retried loop, so a database that is down at start only
 * delays ingest, and a failed run is retried after 10 s with the same options, so the source keeps what it learned (the
 * edge latch, benched endpoints) across retries (plan KTD3, KTD4, KTD7).
 */
export async function ingestForever(
  options: Omit<IndexerOptions, "store"> & { open: () => Promise<Store>; onOpen?: (store: Store) => void },
  run: typeof runIndexer = runIndexer,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<never> {
  const { open, onOpen, ...rest } = options;
  let store: Store | undefined;
  for (;;) {
    try {
      if (!store) {
        store = await open();
        onOpen?.(store);
      }
      await run({ ...rest, store, follow: true });
    } catch (e) {
      console.error(`ingest stopped: ${e instanceof Error ? e.message : String(e)}; resuming in 10 s`);
      await wait(10_000);
    }
  }
}

function ingestOptions(config: IndexerConfig, concurrency: string | undefined): Omit<IndexerOptions, "store"> {
  const { source, label, defaultConcurrency } = chooseSource(config);
  console.error(`block source: ${label}`);
  return {
    source,
    seeds: { factories: config.factories, contracts: config.contracts },
    startBlock: config.start_block,
    concurrency: concurrency ? Number(concurrency) : defaultConcurrency,
  };
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      config: { type: "string" },
      "stop-at": { type: "string" },
      follow: { type: "boolean", default: false },
      concurrency: { type: "string" },
      out: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
    },
  });

  if (cmd === "export") {
    const store = await openStore(connectFromEnv());
    const json = await store.export();
    await store.close();
    if (values.out) await writeFile(values.out, json + "\n");
    else process.stdout.write(json + "\n");
    return 0;
  }

  if (cmd === "serve") {
    const config = loadConfig(values.config);
    const db = connectFromEnv();
    let store: Store | null = null;
    const port = Number(values.port ?? process.env.PORT ?? 8080);
    // The server comes up first, so /health answers (unhealthy) while the database is still unreachable.
    await startServer({ store: () => store, port, host: values.host });
    console.error(`serving on :${port}, database ${databaseHost(process.env.DATABASE_URL!)}`);
    await ingestForever({ ...ingestOptions(config, values.concurrency), open: () => openStore(db), onOpen: (s) => (store = s) });
  }

  if (cmd !== "index" && cmd !== "rebuild") {
    console.error(`unknown command ${cmd}\n\n${USAGE}`);
    return 1;
  }
  const config = loadConfig(values.config);
  const store = await openStore(connectFromEnv());
  if (cmd === "rebuild") {
    console.error(`rebuild: emptying every table in the database on ${databaseHost(process.env.DATABASE_URL!)}`);
    await store.reset();
  }
  const started = Date.now();
  let lastLog = 0;
  await runIndexer({
    ...ingestOptions(config, values.concurrency),
    store,
    stopAt: values["stop-at"] ? Number(values["stop-at"]) : undefined,
    follow: values.follow,
    onProgress: ({ block, head }) => {
      if (Date.now() - lastLog < 10_000 && block < head) return;
      lastLog = Date.now();
      console.error(`indexed through ${block} of ${head} (${Math.round((Date.now() - started) / 1000)}s)`);
    },
  });
  const h = await store.health();
  console.error(`done: last indexed block ${h.last_indexed_block}, unparsed events ${h.unparsed_events}`);
  await store.close();
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
