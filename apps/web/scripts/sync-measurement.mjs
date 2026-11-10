#!/usr/bin/env node
// Copies the numbers the Lab results page shows out of measurement/results/<date>/ into a small JSON file.
// Nothing is typed by hand: counts and call shares are computed from results.jsonl.
//   node scripts/sync-measurement.mjs ../../measurement/results/2026-11-10
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/sync-measurement.mjs <results-dir>");
  process.exit(2);
}
const rows = readFileSync(join(dir, "results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const agg = JSON.parse(readFileSync(join(dir, "aggregate.json"), "utf8"));
const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
const ok = rows.filter((r) => r.ok);
const totalCalls = ok.reduce((s, r) => s + (r.calls ?? 0), 0);
const sum = (pred) => ok.filter(pred).reduce((s, r) => s + (r.calls ?? 0), 0);

const classes = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"].map((c) => ({
  class: c,
  accounts: agg.byClass[c] ?? 0,
  calls: sum((r) => r.classification.class === c),
}));
const bases = Object.keys(agg.byBasis).map((b) => ({
  basis: b,
  class: ok.find((r) => r.classification.evidence.mutabilityBasis === b)?.classification.class,
  accounts: agg.byBasis[b],
  calls: sum((r) => r.classification.evidence.mutabilityBasis === b),
}));
const invisible = ok.filter((r) => r.classification.class === "global_by_account").map((r) => r.accountId);

const out = {
  generatedFrom: dir.split("\\").join("/").replace(/^(\.\.\/)+/, ""),
  network: meta.network,
  input: meta.input,
  window: { from: "2026-10-09", to: "2026-11-08" },
  readAt: meta.startedAt.slice(0, 10),
  blockRange: agg.blockRange,
  total: agg.total,
  classified: agg.classified,
  failed: agg.failed,
  totalCalls,
  classes,
  bases,
  invisible,
};
writeFileSync(new URL("../src/landing/lib/measurement-data.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("wrote src/landing/lib/measurement-data.json");
