#!/usr/bin/env node
// aruna-attestor — watches assigned targets with the shared classifier and files signed drift reports
// and heartbeats to the Aruna registry. TESTNET ONLY. One of the two trust assumptions of Aruna
// coverage (docs/ATTESTOR.md): the contract cannot verify the block it claims a change happened at.
import { parseArgs } from "node:util";
import { createFetchReader } from "@aruna/rpc";
import { assertRegisteredKey, publicKeyOf, signingSeed } from "./keys.js";
import { signReport, type DriftReport } from "./report.js";
import { loadState, saveState } from "./state.js";
import { connect } from "./submit.js";
import { indexerAssignments, resolveTargets } from "./targets.js";
import { bisectChange, observe, reportFor, rpcHashAt, type Observation } from "./watch.js";

export { signReport, signingBytes } from "./report.js";
export { bisectChange, channelOf, observe, reportFor } from "./watch.js";

const USAGE = `aruna-attestor — testnet drift attestor

  aruna-attestor keygen --attestor <account>
      Create the report-signing key (kept apart from the account key) and print its public key.
  aruna-attestor watch --attestor <account> --registry <account> [--targets <a,b>] [--indexer-url <url>] [--interval 10] [--heartbeat-every 18] [--once]
      Watch the targets the registry assigns to this attestor (the indexer lists them; --targets is a seed list that
      covers a lagging indexer; each is confirmed with the registry). Poll each target and file a signed report on a
      change. Every N polls, send a heartbeat and refresh the target list (18 polls of 10 s is about 3 minutes, a third of
      the registry's staleness bound).
  aruna-attestor heartbeat --attestor <account> --registry <account>
  aruna-attestor dispute --attestor <account> --registry <account> --report-id <n> [--shift 1]
      File a report on the same target that claims a different changed_at_block. Disputes report n.

Env:
  ARUNA_RPC_TESTNET                 RPC endpoints, comma-separated (first entry used for transactions)
  ARUNA_ATTESTOR_ACCOUNT_KEY        account key (secret); else ~/.near-credentials/testnet/<account>.json
  ARUNA_ATTESTOR_SIGNING_SEED_HEX   report-signing seed (secret); else ~/.near-credentials/aruna-attestors/<account>.json
  ARUNA_ATTESTOR_STATE_DIR          where observations and the nonce are kept; else ~/.aruna-attestor
  ARUNA_ATTESTOR_TARGETS            the seed list, comma-separated, when --targets is not given
  ARUNA_INDEXER_URL                 the indexer's base URL, when --indexer-url is not given`;

const REPORT_TTL_BLOCKS = 600;
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
      "heartbeat-every": { type: "string", default: "18" },
      "indexer-url": { type: "string" },
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
  const rpcUrl = endpoints?.[0] ?? "https://rpc.testnet.fastnear.com";
  const chain = connect(attestor, registry, rpcUrl);
  const seed = signingSeed(attestor);
  assertRegisteredKey(attestor, await chain.view<{ signing_key: string } | null>("get_attestor", { attestor }), seed);
  log(`${attestor} on ${registry}: signing key ${publicKeyOf(seed)} matches the registry`);

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
    const seedTargets = (values.targets ?? process.env.ARUNA_ATTESTOR_TARGETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const indexerUrl = values["indexer-url"] ?? process.env.ARUNA_INDEXER_URL;
    const assigned = indexerUrl ? indexerAssignments({ baseUrl: indexerUrl, attestor, registry }) : undefined;
    if (!assigned && seedTargets.length === 0) log("no --indexer-url and no --targets: watching nothing until one is given, heartbeats only");
    const every = Number(values["heartbeat-every"]);
    let heartbeatDue = true;
    for (let poll = 0; ; poll++) {
      const state = loadState(attestor);
      // The target list is refreshed with each heartbeat, so an assignment is picked up without a restart.
      if (poll % every === 0) {
        state.targets = await resolveTargets({
          attestor,
          seed: seedTargets,
          last: state.targets ?? [],
          assigned,
          assignedAttestor: (target) => chain.view<string | null>("assigned_attestor", { target }),
          log,
        });
        log(`watching ${state.targets.length === 0 ? "nothing" : state.targets.join(", ")}`);
      }
      for (const t of state.targets ?? []) {
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
            // Narrow the claim to the first block running the new code, when history is readable.
            try {
              const exact = await bisectChange(rpcHashAt(t, rpcUrl), prev.block, cur.block, r.after_resolved_hash);
              if (exact !== null) r.changed_at_block = exact;
            } catch (e) {
              log(`${t}: history unreadable, keeping changed_at_block ${r.changed_at_block} (${e instanceof Error ? e.message : e})`);
            }
            state.nonce += 1;
            try {
              const filed = await chain.report(r, signReport(r, seed).toString("base64"));
              log(`${t}: ${r.channel} ${r.before_resolved_hash} -> ${r.after_resolved_hash}, changed_at_block ${r.changed_at_block}; report ${filed.id}  tx ${filed.tx}`);
            } catch (e) {
              // The registry refused it (e.g. ARUNA_OUTSIDE_LOOKBACK when the change is older than the
              // lookback bound). The change is still the new baseline; the daemon keeps running.
              log(`${t}: ${r.channel} changed_at_block ${r.changed_at_block}; REPORT REFUSED: ${e instanceof Error ? e.message : e}`);
            }
          }
        } else {
          log(`${t}: first observation at block ${cur.block}, resolved ${cur.resolvedHash}`);
        }
        state.observations[t] = cur;
      }
      saveState(attestor, state);
      if (poll % every === 0) heartbeatDue = true;
      if (heartbeatDue) {
        // A failed heartbeat (RPC limit, network) is logged and retried at the next poll rather than ending the
        // daemon; the registry marks the attestor stale only after HEARTBEAT_STALE_BLOCKS without one.
        try {
          log(`heartbeat ${await chain.heartbeat()}`);
          heartbeatDue = false;
        } catch (e) {
          log(`heartbeat FAILED, retrying at the next poll: ${e instanceof Error ? e.message : e}`);
        }
      }
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
