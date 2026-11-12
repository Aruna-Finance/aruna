#!/usr/bin/env node
// One command that regenerates every result and chart (plan U17, R42).
//   aruna-sim [--date YYYY-MM-DD] [--runs 1000] [--derive-runs 1000] [--out <dir>]
//       simulate every scenario and the derivation sweeps, write raw/ and assumptions.json, then build
//       summary.json, charts/ and REPORT.md from raw/ alone
//   aruna-sim --rebuild <dir>   rebuild summary.json, charts/ and REPORT.md from <dir>/raw/ without simulating
//   aruna-sim --check <dir>     rebuild in memory and fail if any committed file differs
// Deterministic: the same arguments give the same files. Pass --date to keep the date of a published run.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildAll } from "./build.js";
import { generate, writeBuilt } from "./generate.js";

const here = dirname(fileURLToPath(import.meta.url));

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { date: { type: "string" }, runs: { type: "string", default: "1000" }, "derive-runs": { type: "string", default: "1000" }, out: { type: "string" }, rebuild: { type: "string" }, check: { type: "string" } },
  });
  if (values.check) {
    const dir = resolve(values.check);
    const built = buildAll(dir);
    const differ = Object.entries(built).filter(([rel, content]) => !existsSync(join(dir, rel)) || readFileSync(join(dir, rel), "utf8") !== content).map(([rel]) => rel);
    if (differ.length) {
      console.error(`not reproducible from raw/: ${differ.join(", ")}`);
      return 1;
    }
    console.log(`ok: ${Object.keys(built).length} files in ${dir} equal what raw/ produces`);
    return 0;
  }
  if (values.rebuild) {
    writeBuilt(resolve(values.rebuild));
    console.log(`rebuilt summary.json, charts/ and REPORT.md in ${resolve(values.rebuild)}`);
    return 0;
  }
  const date = values.date ?? new Date().toISOString().slice(0, 10);
  const dir = resolve(values.out ?? join(here, "..", "results", date));
  generate(dir, { date, runs: Number(values.runs), deriveRuns: Number(values["derive-runs"]) }, (l) => process.stderr.write(l + "\n"));
  console.log(`wrote ${dir}`);
  return 0;
}

// pnpm forwards a literal "--" ahead of the arguments after the script name; drop it.
process.exit(main(process.argv.slice(2).filter((a) => a !== "--")));
