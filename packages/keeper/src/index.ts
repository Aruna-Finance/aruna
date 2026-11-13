#!/usr/bin/env node
import { classify } from "@aruna/classifier-core";
import { createFetchReader } from "@aruna/rpc";
import { fetchViewTransport, Registry } from "@aruna/sdk/coverage";
import { nearApiTransport } from "@aruna/sdk/vault";
import { parseArgs } from "node:util";
import { keeperKey } from "./keys.js";
import { gatherCandidates, indexerReportTargets, runOnce, type KeeperChain } from "./run.js";

const USAGE = `aruna-keeper: testnet freeze keeper

  aruna-keeper run --account <registry owner> --registry <account> [--targets <a,b>] [--indexer-url <url>] [--interval 60] [--once]
      Every interval, for each target with a final drift report newer than its class record: classify its current code,
      lift the freeze when the new class is no riskier than the recorded one, and write the new class. A riskier class is
      written and the freeze stays for an operator. Targets come from the indexer's reports plus the seed list.

Flags fall back to the environment:
  ARUNA_KEEPER_ACCOUNT     --account
  ARUNA_KEEPER_REGISTRY    --registry
  ARUNA_KEEPER_TARGETS     --targets, the seed list, comma-separated
  ARUNA_INDEXER_URL        --indexer-url
  ARUNA_KEEPER_KEY         the account key (secret); else ~/.near-credentials/testnet/<account>.json
  ARUNA_RPC_TESTNET        RPC endpoints, comma-separated (first entry used for transactions)`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

const TGAS = 30n;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      account: { type: "string" },
      registry: { type: "string" },
      targets: { type: "string" },
      "indexer-url": { type: "string" },
      interval: { type: "string", default: "60" },
      once: { type: "boolean", default: false },
    },
  });
  if (!cmd || cmd === "--help" || cmd === "help") {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }
  if (cmd !== "run") {
    console.error(USAGE);
    return 2;
  }
  const account = values.account ?? process.env.ARUNA_KEEPER_ACCOUNT;
  const registryId = values.registry ?? process.env.ARUNA_KEEPER_REGISTRY;
  if (!account) throw new Error("--account (or ARUNA_KEEPER_ACCOUNT) is required");
  if (!registryId) throw new Error("--registry (or ARUNA_KEEPER_REGISTRY) is required");
  if (!account.endsWith(".testnet") || !registryId.endsWith(".testnet")) throw new Error("refusing: the keeper runs on testnet only");
  const seed = (values.targets ?? process.env.ARUNA_KEEPER_TARGETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const indexerUrl = values["indexer-url"] ?? process.env.ARUNA_INDEXER_URL;
  const interval = Number(values.interval);

  const endpoints = process.env.ARUNA_RPC_TESTNET?.split(",").map((s) => s.trim()).filter(Boolean);
  const reader = createFetchReader({ network: "testnet", endpoints, rotate: true });
  const registry = new Registry({ registry: registryId, transport: fetchViewTransport({ network: "testnet", endpoints }) });
  const tx = nearApiTransport({ signerId: account, privateKey: keeperKey(account), network: "testnet", rpcUrl: endpoints?.[0] });
  const call = async (method: string, args: Record<string, unknown>) => (await tx.call(registryId, method, args, { depositYocto: 0n, tgas: TGAS })).tx;
  const chain: KeeperChain = {
    classOf: (t) => registry.classOf(t),
    latestReport: (t) => registry.latestReport(t),
    liftFreeze: (t) => call("lift_freeze", { target: t }),
    setClass: (a) => call("set_class", a),
  };
  const reportTargets = indexerUrl ? indexerReportTargets({ baseUrl: indexerUrl, registry: registryId }) : undefined;
  if (!reportTargets && seed.length === 0) log("no --indexer-url and no --targets: nothing to look at until one is given");
  log(`keeper ${account} on ${registryId}, key ${await tx.publicKey()}`);

  for (;;) {
    try {
      const targets = await gatherCandidates({ seed, reportTargets, log });
      const outcomes = await runOnce({ chain, classify: (t) => classify(t, reader), targets, log });
      const acted = outcomes.filter((o) => o.result === "released" || o.result === "written" || o.result === "held").length;
      const failed = outcomes.filter((o) => o.result === "failed").length;
      log(`checked ${targets.length} target(s): ${acted} acted on, ${failed} failed`);
    } catch (e) {
      log(`run failed, trying again next interval (${e instanceof Error ? e.message : e})`);
    }
    if (values.once) return 0;
    await sleep(interval * 1000);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("aruna-keeper")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
