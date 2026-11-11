#!/usr/bin/env node
// aruna-indexer — reads Aruna's testnet events from the public block archive into one SQLite file.
// Holds no keys and sends no transactions (R5).

import { readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runIndexer, type IndexerOptions } from "./indexer.js";
import { neardataSource } from "./ingest/neardata.js";
import { startServer } from "./server.js";
import { sleep } from "./sleep.js";
import { openStore } from "./store.js";

const USAGE = `aruna-indexer — Aruna's testnet history, rebuilt from chain data alone.

Usage:
  aruna-indexer index   [--db <file>] [--config <file>] [--stop-at <block>] [--follow] [--concurrency 16]
      Read blocks from the committed cursor (or the config's start block) to the head, or to --stop-at.
      --follow keeps reading new blocks as they become final.
  aruna-indexer rebuild [--db <file>] [--config <file>] [--stop-at <block>] [--concurrency 16]
      Delete the store and read everything again from the start block. Takes hours from scratch.
  aruna-indexer serve   [--db <file>] [--config <file>] [--port 8080] [--concurrency 16]
      Serve the read API and keep indexing new blocks in the same process. A failed read is retried.
  aruna-indexer export  [--db <file>] [--out <file>]
      Write every derived table as canonical JSON. Two stores built from the same blocks export the same bytes.

Environment: ARUNA_INDEXER_DB (default ./aruna-indexer.sqlite), ARUNA_INDEXER_CONFIG, and FASTNEAR_API_KEY.
Without FASTNEAR_API_KEY, neardata serves 30 blocks a minute, too slow to backfill or to follow the head.`;

export interface IndexerConfig {
  network: string;
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

function ingestOptions(config: IndexerConfig, store: IndexerOptions["store"], concurrency: string | undefined): IndexerOptions {
  return {
    store,
    source: neardataSource({ baseUrl: config.neardata, apiKey: process.env.FASTNEAR_API_KEY || undefined }),
    seeds: { factories: config.factories, contracts: config.contracts },
    startBlock: config.start_block,
    concurrency: concurrency ? Number(concurrency) : undefined,
  };
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
    const store = openStore(dbPath);
    const port = Number(values.port ?? process.env.PORT ?? 8080);
    await startServer({ store, port, host: values.host });
    console.error(`serving on :${port}, store ${dbPath}`);
    for (;;) {
      try {
        await runIndexer({ ...ingestOptions(config, store, values.concurrency), follow: true });
      } catch (e) {
        console.error(`ingest stopped: ${e instanceof Error ? e.message : String(e)}; resuming in 10 s`);
        await sleep(10_000);
      }
    }
  }

  if (cmd !== "index" && cmd !== "rebuild") {
    console.error(`unknown command ${cmd}\n\n${USAGE}`);
    return 1;
  }
  const config = loadConfig(values.config);
  if (cmd === "rebuild") removeStore(dbPath);
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

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
