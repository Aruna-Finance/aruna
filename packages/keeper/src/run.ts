// One keeper run: for each candidate target, decide from the chain whether it is unhandled, and if so re-classify it
// with the shared engine, then lift the freeze and write the class (decide.ts holds the rules).
import type { Classification } from "@aruna/classifier-core";
import { createIndexerClient } from "@aruna/indexer/client";
import { classRecordArgs, type ClassRecord, type DriftReport, type SetClassArgs } from "@aruna/sdk/coverage";
import { decide, skipReason, type SkipReason } from "./decide.js";

/** The registry, as the keeper uses it: two views and the two calls only the registry owner can make. */
export interface KeeperChain {
  classOf(target: string): Promise<ClassRecord | null>;
  latestReport(target: string): Promise<DriftReport | null>;
  liftFreeze(target: string): Promise<string>;
  setClass(args: SetClassArgs): Promise<string>;
}

export interface RunDeps {
  chain: KeeperChain;
  /** The shared classification engine, `classify` from @aruna/classifier-core over a reader. Rejects only on transport failure. */
  classify: (target: string) => Promise<Classification>;
  targets: string[];
  log: (msg: string) => void;
}

export interface Outcome {
  target: string;
  result: "skipped" | "released" | "written" | "held" | "failed";
  reason?: SkipReason;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runOnce(d: RunDeps): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const target of d.targets) out.push(await handle(d, target));
  return out;
}

async function handle(d: RunDeps, target: string): Promise<Outcome> {
  let record: ClassRecord | null;
  let report: DriftReport | null;
  try {
    [record, report] = await Promise.all([d.chain.classOf(target), d.chain.latestReport(target)]);
  } catch (e) {
    d.log(`${target}: could not read the registry, trying again next run (${msg(e)})`);
    return { target, result: "failed" };
  }
  const reason = skipReason(record, report);
  if (reason) return { target, result: "skipped", reason };
  const current = record!;
  const latest = report!;

  let classification: Classification;
  try {
    classification = await d.classify(target);
  } catch (e) {
    d.log(`${target}: could not classify its code, trying again next run (${msg(e)})`);
    return { target, result: "failed" };
  }
  const action = decide(current, classification.class);
  const change = `${current.class} -> ${classification.class}, report ${latest.id}`;

  if (action === "lift_then_write") {
    try {
      const tx = await d.chain.liftFreeze(target);
      d.log(`${target}: freeze lifted (${change})  tx ${tx}`);
    } catch (e) {
      // Nothing was written, so the record is still older than the report and the next run starts again at the lift.
      d.log(`${target}: lifting the freeze failed, trying again next run (${msg(e)})`);
      return { target, result: "failed" };
    }
  }
  try {
    const tx = await d.chain.setClass(await classRecordArgs(target, classification));
    d.log(`${target}: class written (${change})  tx ${tx}`);
  } catch (e) {
    d.log(`${target}: writing the class failed, trying again next run (${msg(e)})`);
    return { target, result: "failed" };
  }
  if (action === "hold_and_write") {
    d.log(`${target}: HELD, the freeze stays: the new code is riskier (${change}). An operator decides; lift_freeze releases it.`);
    return { target, result: "held" };
  }
  return { target, result: action === "lift_then_write" ? "released" : "written" };
}

/** The seed list plus the indexer's targets, without repeats; the seed alone when the indexer cannot be read. */
export async function gatherCandidates(o: { seed: string[]; reportTargets?: () => Promise<string[]>; log: (msg: string) => void }): Promise<string[]> {
  let fromIndexer: string[] = [];
  if (o.reportTargets) {
    try {
      fromIndexer = await o.reportTargets();
    } catch (e) {
      o.log(`the indexer could not be read, using the seed list alone (${msg(e)})`);
    }
  }
  return [...new Set([...o.seed, ...fromIndexer])];
}

/**
 * Every target the registry has a report for, from the indexer. Any state: a target stays listed after its freeze is
 * lifted, so a release that stopped half way is found again, and the chain decides what is final.
 */
export function indexerReportTargets(o: { baseUrl: string; registry: string; fetch?: typeof fetch }): () => Promise<string[]> {
  const client = createIndexerClient({ baseUrl: o.baseUrl, fetch: o.fetch });
  return async () => {
    const targets = new Set<string>();
    let after: number | undefined;
    for (;;) {
      const page = await client.reports({ registry: o.registry, after });
      for (const r of page.items) targets.add(r.target);
      if (page.next_after === null) return [...targets];
      if (after !== undefined && page.next_after <= after) throw new Error("the indexer returned a cursor that does not advance");
      after = page.next_after;
    }
  };
}
