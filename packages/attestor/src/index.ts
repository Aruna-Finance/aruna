#!/usr/bin/env node
// aruna-attestor — watches assigned targets with the shared classifier and files signed drift reports
// and heartbeats to the Aruna registry. TESTNET ONLY. One of the two trust assumptions of Aruna
// coverage (docs/ATTESTOR.md): the contract cannot verify the block it claims a change happened at.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createFetchReader } from "@aruna/rpc";
import { publicKeyOf, signingSeed } from "./keys.js";
import { signReport, type DriftReport } from "./report.js";
import { connect } from "./submit.js";
import { observe, reportFor, type Observation } from "./watch.js";

export { signReport, signingBytes } from "./report.js";
export { channelOf, observe, reportFor } from "./watch.js";

const USAGE = `aruna-attestor — testnet drift attestor

  aruna-attestor keygen --attestor <account>
      Create the report-signing key (kept apart from the account key) and print its public key.
  aruna-attestor watch --attestor <account> --registry <account> --targets <a,b> [--interval 10] [--heartbeat-every 6] [--once]
      Poll each target; file a signed report on a change; send a heartbeat every N polls.
  aruna-attestor heartbeat --attestor <account> --registry <account>
  aruna-attestor dispute --attestor <account> --registry <account> --report-id <n> [--shift 1]
      File a report on the same target that claims a different changed_at_block. Disputes report n.

Env: ARUNA_RPC_TESTNET overrides the endpoint (first entry used for transactions).`;

const REPORT_TTL_BLOCKS = 600;
const statePath = (attestor: string) => join(homedir(), ".aruna-attestor", `${attestor}.json`);
interface State {
  nonce: number;
  observations: Record<string, Observation>;
}
function loadState(attestor: string): State {
  const p = statePath(attestor);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { nonce: Date.now(), observations: {} };
}
function saveState(attestor: string, s: State) {
  mkdirSync(join(homedir(), ".aruna-attestor"), { recursive: true, mode: 0o700 });
  writeFileSync(statePath(attestor), JSON.stringify(s, null, 2), { mode: 0o600 });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      attestor: { type: "string" },
      registry: { type: "string" },
      targets: { type: "string" },
      interval: { type: "string", default: "10" },
      "heartbeat-every": { type: "string", default: "6" },
      once: { type: "boolean", default: false },
      "report-id": { type: "string" },
      shift: { type: "string", default: "1" },
    },
  });
  if (!cmd || cmd === "--help" || cmd === "help") {
    console.log(USAGE);
    return cmd ? 0 : 1;
  }
  const attestor = values.attestor;
  if (!attestor) throw new Error("--attestor is required");
  if (cmd === "keygen") {
    console.log(publicKeyOf(signingSeed(attestor, true)));
    return 0;
  }
  const registry = values.registry;
  if (!registry) throw new Error("--registry is required");
  const endpoints = process.env.ARUNA_RPC_TESTNET?.split(",").map((s) => s.trim()).filter(Boolean);
  const reader = createFetchReader({ network: "testnet", endpoints, rotate: true });
  const chain = connect(attestor, registry, endpoints?.[0] ?? "https://rpc.testnet.fastnear.com");
  const seed = signingSeed(attestor);

  if (cmd === "heartbeat") {
    log(`heartbeat ${await chain.heartbeat()}`);
    return 0;
  }

  if (cmd === "dispute") {
    const id = Number(values["report-id"]);
    const stored = await chain.view<{ report: DriftReport } | null>("get_report", { id });
    if (!stored) throw new Error(`no report ${id}`);
    const state = loadState(attestor);
    const r: DriftReport = { ...stored.report, attestor, nonce: ++state.nonce, changed_at_block: stored.report.changed_at_block + Number(values.shift) };
    if (r.changed_at_block > r.observed_at_block) r.observed_at_block = r.changed_at_block;
    const filed = await chain.report(r, signReport(r, seed).toString("base64"));
    saveState(attestor, state);
    log(`dispute filed: report ${filed.id} claims changed_at_block ${r.changed_at_block} against report ${id}  tx ${filed.tx}`);
    return 0;
  }

  if (cmd === "watch") {
    const targets = (values.targets ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (targets.length === 0) throw new Error("--targets is required");
    const every = Number(values["heartbeat-every"]);
    for (let poll = 0; ; poll++) {
      const state = loadState(attestor);
      for (const t of targets) {
        let cur: Observation;
        try {
          cur = await observe(t, reader);
        } catch (e) {
          log(`${t}: read failed, nothing observed (${e instanceof Error ? e.message : e})`);
          continue;
        }
        const prev = state.observations[t];
        if (prev) {
          const r = reportFor(prev, cur, attestor, state.nonce + 1, REPORT_TTL_BLOCKS);
          if (r) {
            state.nonce += 1;
            const filed = await chain.report(r, signReport(r, seed).toString("base64"));
            log(`${t}: ${r.channel} ${r.before_resolved_hash} -> ${r.after_resolved_hash}, changed_at_block ${r.changed_at_block}; report ${filed.id}  tx ${filed.tx}`);
          }
        } else {
          log(`${t}: first observation at block ${cur.block}, resolved ${cur.resolvedHash}`);
        }
        state.observations[t] = cur;
      }
      saveState(attestor, state);
      if (poll % every === 0) log(`heartbeat ${await chain.heartbeat()}`);
      if (values.once) return 0;
      await sleep(Number(values.interval) * 1000);
    }
  }
  console.error(USAGE);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("aruna-attestor")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
