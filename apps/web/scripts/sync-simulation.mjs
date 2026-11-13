#!/usr/bin/env node
// Copies the numbers the Simulation screen shows out of packages/sim/results/<date>/ into a small JSON file.
// Nothing is typed by hand; simulation.test.ts re-derives the file from the same folder.
//   node scripts/sync-simulation.mjs ../../packages/sim/results/2026-11-12
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/sync-simulation.mjs <results-dir>");
  process.exit(2);
}
const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
const assume = JSON.parse(readFileSync(join(dir, "assumptions.json"), "utf8"));

const scenarios = summary.scenarios.map((s) => {
  const a = assume.scenarios.find((x) => x.id === s.id);
  const as = a.assumptions;
  return {
    id: s.id,
    title: s.title,
    note: a.note,
    breaksThePool: a.breaksThePool === true,
    counterfactual: a.counterfactual === true,
    startingCapitalNear: as.pool.startingCapitalNear,
    adequacyOn: as.pool.book.adequacy !== false,
    concentrationOn: as.pool.book.concentration !== false,
    lockEnforced: as.pool.book.lockEnforced !== false,
    scripted: as.events.scripted,
    withdrawal: as.underwriter.withdrawal,
    pInsolvency: s.probabilityInsolvency,
    endingCapitalNear: s.endingCapitalNear,
    claimsPaidNear: s.claimsPaidNear,
    peakUnpaidNear: s.peakUnpaidNear,
    claimsUnpaidNear: s.claimsUnpaidNear,
    solvencyRatio: s.solvencyRatio,
    maxDrawdown: s.maxDrawdown,
    timeToInsolvencyDays: s.timeToInsolvencyDays,
  };
});
const first = assume.scenarios[0].assumptions;
const out = {
  generatedFrom: dir.split("\\").join("/").replace(/^(\.\.\/)+/, ""),
  date: summary.date,
  runsPerScenario: summary.runsPerScenario,
  firstSeed: assume.firstSeed,
  agents: first.agents,
  days: first.days,
  pEventBps30d: assume.poolParams.pEventBps30d,
  poolParams: { kX100: assume.poolParams.kX100, concentrationBps: assume.poolParams.concentrationBps },
  scenarios,
};
writeFileSync(new URL("../src/console/data/simulation-data.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("wrote src/console/data/simulation-data.json");
