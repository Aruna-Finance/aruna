// Writing a results directory: simulate every scenario and the derivation, then build everything derived
// from the raw files. Split from the command line so tests can call it.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildAll, summarize, type AssumptionsFile } from "./build.js";
import { derive } from "./derive.js";
import { simulate } from "./model.js";
import { CONTRACT_PARAMS } from "./rules.js";
import { scenarios } from "./scenarios.js";

const bigintJson = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

function write(dir: string, rel: string, content: string) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export function writeBuilt(dir: string) {
  for (const [rel, content] of Object.entries(buildAll(dir))) write(dir, rel, content);
}

export function simulateAll(dir: string, o: { date: string; runs: number; deriveRuns: number }, log: (line: string) => void = () => {}) {
  const list = scenarios();
  const meta: AssumptionsFile = {
    date: o.date,
    runsPerScenario: o.runs,
    firstSeed: 1,
    derivationRunsPerCell: o.deriveRuns,
    poolParams: JSON.parse(JSON.stringify(CONTRACT_PARAMS, bigintJson)),
    scenarios: list.map((s) => ({ id: s.id, title: s.title, note: s.note, breaksThePool: s.breaksThePool, counterfactual: s.counterfactual, assumptions: JSON.parse(JSON.stringify(s.assumptions, bigintJson)) })),
  };
  write(dir, "assumptions.json", JSON.stringify(meta, null, 2) + "\n");
  for (const s of list) {
    const runs = Array.from({ length: o.runs }, (_, i) => simulate(s.assumptions, i + 1).summary);
    write(dir, `raw/runs-${s.id}.jsonl`, runs.map((x) => JSON.stringify(x)).join("\n") + "\n");
    const rep = summarize(s.id, s.title, runs).representativeSeed;
    write(dir, `raw/series-${s.id}.json`, JSON.stringify({ seed: rep, series: simulate(s.assumptions, rep).series }) + "\n");
    log(`simulated ${s.id}: ${o.runs} runs`);
  }
  log(`deriving (${o.deriveRuns} runs per cell)...`);
  write(dir, "raw/derivation.json", JSON.stringify(derive(o.deriveRuns), null, 2) + "\n");
}

export function generate(dir: string, o: { date: string; runs: number; deriveRuns: number }, log?: (line: string) => void) {
  simulateAll(dir, o, log);
  writeBuilt(dir);
}
