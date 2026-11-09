#!/usr/bin/env node
// aruna — read-only operations. Never signs, never sends a transaction.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { classify, parseImports, SCANNED_IMPORTS } from "@aruna/classifier-core";
import { createFetchReader, type Network } from "@aruna/rpc";
import { aggregate, readAccounts, runMeasure, writeMeasurement } from "./measure-cmd.js";

const USAGE = `aruna — can this NEAR contract still change?

Usage:
  aruna classify <account-id> [--network mainnet|testnet]
      Print the class, basis and full evidence as JSON.
  aruna measure --in <accounts.csv> --out <dir> [--network mainnet] [--concurrency 8] [--retries 2] [--backoff-ms 1000]
      Classify every account in the CSV (column account_id or receipt_receiver_account_id).
      Writes results.jsonl, aggregate.json and meta.json. Failed reads are listed apart, never as unknown.
  aruna imports <file.wasm>
      List a module's imports and the scanned host functions among them.

Environment: ARUNA_RPC_MAINNET / ARUNA_RPC_TESTNET override the endpoints (comma-separated).`;

function network(v: string | undefined): Network {
  const n = v ?? "mainnet";
  if (n !== "mainnet" && n !== "testnet") throw new Error(`--network must be mainnet or testnet, got ${n}`);
  return n;
}

function reader(net: Network) {
  const override = process.env[net === "mainnet" ? "ARUNA_RPC_MAINNET" : "ARUNA_RPC_TESTNET"];
  const endpoints = override ? override.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  return createFetchReader({ network: net, endpoints });
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }

  if (cmd === "classify") {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { network: { type: "string" } } });
    if (positionals.length !== 1) throw new Error("classify takes exactly one account id");
    const c = await classify(positionals[0], reader(network(values.network)));
    console.log(JSON.stringify(c, null, 2));
    return 0;
  }

  if (cmd === "measure") {
    const { values } = parseArgs({
      args: rest,
      options: {
        in: { type: "string" },
        out: { type: "string" },
        network: { type: "string" },
        concurrency: { type: "string", default: "8" },
        retries: { type: "string", default: "2" },
        "backoff-ms": { type: "string", default: "1000" },
      },
    });
    if (!values.in || !values.out) throw new Error("measure needs --in <accounts.csv> and --out <dir>");
    const net = network(values.network);
    const rows = await readAccounts(values.in);
    const r = reader(net);
    const started = new Date().toISOString();
    const results = await runMeasure(rows, r, {
      concurrency: Number(values.concurrency),
      retries: Number(values.retries),
      backoffMs: Number(values["backoff-ms"]),
      onProgress: (done, total) => {
        if (done % 50 === 0 || done === total) process.stderr.write(`classified ${done}/${total}\n`);
      },
    });
    await writeMeasurement(values.out, results, {
      input: values.in,
      network: net,
      endpoints: r.endpoints,
      startedAt: started,
      finishedAt: new Date().toISOString(),
    });
    const agg = aggregate(results);
    console.log(JSON.stringify({ byClass: agg.byClass, byBasis: agg.byBasis, failed: agg.failed.length }, null, 2));
    return agg.failed.length === 0 ? 0 : 2;
  }

  if (cmd === "imports") {
    if (rest.length !== 1) throw new Error("imports takes exactly one .wasm file");
    const parsed = parseImports(new Uint8Array(await readFile(rest[0])));
    if (!parsed.ok) {
      console.error(`not parseable: ${parsed.error}`);
      return 1;
    }
    const funcs = parsed.imports.filter((i) => i.kind === "func").map((i) => i.name);
    const scanned = funcs.filter((f) => SCANNED_IMPORTS.includes(f));
    console.log(JSON.stringify({ imports: funcs, scannedPresent: scanned }, null, 2));
    return 0;
  }

  console.error(`unknown command ${cmd}\n\n${USAGE}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
