// From raw result files to everything derived: summary.json, the charts and REPORT.md. Reads only
// `<dir>/assumptions.json` and `<dir>/raw/`, never the simulator, so a chart or a table can only come
// from recorded runs (plan R42). `aruna-sim --check <dir>` rebuilds in memory and compares to the disk.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { barChart, lineChart } from "./charts.js";
import type { Derivation, Sweep } from "./derive.js";
import type { DayPoint, RunSummary } from "./model.js";
import { mean, median, quantile, r, wilson } from "./stats.js";

export interface ScenarioMeta {
  id: string;
  title: string;
  note: string;
  breaksThePool?: boolean;
  counterfactual?: boolean;
  assumptions: Record<string, any>;
}
export interface AssumptionsFile {
  date: string;
  runsPerScenario: number;
  firstSeed: number;
  derivationRunsPerCell: number;
  poolParams: Record<string, unknown>;
  scenarios: ScenarioMeta[];
}

export interface ScenarioSummary {
  id: string;
  title: string;
  runs: number;
  probabilityInsolvency: { p: number; lo: number; hi: number };
  endingCapitalNear: { median: number; p5: number; p95: number };
  claimsPaidNear: { median: number };
  claimsPaidCount: { median: number };
  claimsUnpaidNear: { median: number; p95: number };
  claimsUnpaidCount: { median: number };
  peakUnpaidNear: { median: number; p95: number };
  solvencyRatio: { median: number | null; p5: number | null };
  maxDrawdown: { median: number; p95: number };
  timeToInsolvencyDays: { median: number | null; insolventRuns: number };
  coveragesBought: { median: number };
  changes: { median: number };
  purchasesRefusedMean: { capital_adequacy: number; concentration: number; frozen: number };
  withdrawal: { runsExecuted: number; meanRefusedAttempts: number; medianAmountNearWhenExecuted: number | null } | null;
  representativeSeed: number;
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

export function loadRaw(dir: string) {
  const assumptions = readJson<AssumptionsFile>(join(dir, "assumptions.json"));
  const runs: Record<string, RunSummary[]> = {};
  const series: Record<string, { seed: number; series: DayPoint[] }> = {};
  for (const s of assumptions.scenarios) {
    runs[s.id] = readFileSync(join(dir, "raw", `runs-${s.id}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l) as RunSummary);
    series[s.id] = readJson(join(dir, "raw", `series-${s.id}.json`));
  }
  const derivation = readJson<Derivation>(join(dir, "raw", "derivation.json"));
  return { assumptions, runs, series, derivation, files: readdirSync(join(dir, "raw")) };
}

const num = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Number.isFinite(x));

export function summarize(id: string, title: string, runs: RunSummary[]): ScenarioSummary {
  const ending = runs.map((x) => x.endingCapitalNear);
  const med = median(ending);
  const rep = runs.reduce((best, x) => (Math.abs(x.endingCapitalNear - med) < Math.abs(best.endingCapitalNear - med) ? x : best), runs[0]);
  const ins = runs.filter((x) => x.insolvent);
  const sol = num(runs.map((x) => x.solvencyRatio));
  const w = runs.filter((x) => x.withdrawal);
  const executed = w.filter((x) => x.withdrawal!.executedDay !== null);
  return {
    id,
    title,
    runs: runs.length,
    probabilityInsolvency: (({ p, lo, hi }) => ({ p: r(p), lo: r(lo), hi: r(hi) }))(wilson(ins.length, runs.length)),
    endingCapitalNear: { median: r(med, 1), p5: r(quantile(ending, 0.05), 1), p95: r(quantile(ending, 0.95), 1) },
    claimsPaidNear: { median: r(median(runs.map((x) => x.claimsPaidNear)), 1) },
    claimsPaidCount: { median: median(runs.map((x) => x.claimsPaidCount)) },
    claimsUnpaidNear: { median: r(median(runs.map((x) => x.claimsUnpaidNear)), 1), p95: r(quantile(runs.map((x) => x.claimsUnpaidNear), 0.95), 1) },
    claimsUnpaidCount: { median: median(runs.map((x) => x.claimsUnpaidCount)) },
    peakUnpaidNear: { median: r(median(runs.map((x) => x.peakUnpaidNear)), 1), p95: r(quantile(runs.map((x) => x.peakUnpaidNear), 0.95), 1) },
    solvencyRatio: { median: sol.length ? r(median(sol), 2) : null, p5: sol.length ? r(quantile(sol, 0.05), 2) : null },
    maxDrawdown: { median: r(median(runs.map((x) => x.maxDrawdown)), 3), p95: r(quantile(runs.map((x) => x.maxDrawdown), 0.95), 3) },
    timeToInsolvencyDays: { median: ins.length ? r(median(ins.map((x) => x.timeToInsolvencyDays!)), 1) : null, insolventRuns: ins.length },
    coveragesBought: { median: median(runs.map((x) => x.coveragesBought)) },
    changes: { median: median(runs.map((x) => x.changes)) },
    purchasesRefusedMean: {
      capital_adequacy: r(mean(runs.map((x) => x.purchasesRefused.capital_adequacy)), 1),
      concentration: r(mean(runs.map((x) => x.purchasesRefused.concentration)), 1),
      frozen: r(mean(runs.map((x) => x.purchasesRefused.frozen)), 1),
    },
    withdrawal: w.length
      ? { runsExecuted: executed.length, meanRefusedAttempts: r(mean(w.map((x) => x.withdrawal!.refusedAttempts)), 1), medianAmountNearWhenExecuted: executed.length ? r(median(executed.map((x) => x.withdrawal!.amountNear)), 1) : null }
      : null,
    representativeSeed: rep.seed,
  };
}

const BAR_LABEL: Record<string, string> = {
  normal: "Normal operation",
  single_target_changes: "One target changes",
  correlated_mass_claims: "Mass correlated claims",
  underwriter_withdrawal: "Withdrawal, lock on",
  underwriter_withdrawal_without_lock: "Withdrawal, lock off (counterfactual)",
  insufficient_capital: "Capital not enough",
};
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const n0 = (x: number) => Math.round(x).toLocaleString("en-US");
const ci = (p: { p: number; lo: number; hi: number }) => `${pct(p.p)} (${pct(p.lo)} to ${pct(p.hi)})`;
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((x) => `| ${x.join(" | ")} |`)].join("\n");

function sweepTable(s: Sweep): string {
  const scen = ["normal", "single_target_changes", "correlated_mass_claims"];
  const values = [...new Set(s.cells.map((c) => c.value))];
  return table(
    [s.parameter === "k" ? "k" : "limit on one hash or authority, x capital", "normal", "one target changes", "mass correlated claims"],
    values.map((v) => [`${v}`, ...scen.map((id) => { const c = s.cells.find((x) => x.value === v && x.scenario === id)!; return `${pct(c.p)}${c.withinBound ? "" : " **over**"}`; })]),
  );
}

export function buildAll(dir: string): Record<string, string> {
  const { assumptions, runs, series, derivation } = loadRaw(dir);
  const out: Record<string, string> = {};
  const sums = assumptions.scenarios.map((s) => summarize(s.id, s.title, runs[s.id]));
  out["summary.json"] = JSON.stringify({ date: assumptions.date, runsPerScenario: assumptions.runsPerScenario, scenarios: sums }, null, 2) + "\n";

  // charts, from the raw series and the raw runs only
  for (const s of assumptions.scenarios) {
    const sr = series[s.id].series;
    const sum = sums.find((x) => x.id === s.id)!;
    const markers = [
      ...(s.assumptions.events.scripted as { day: number; kind: string }[]).map((e) => ({ x: e.day, label: e.kind === "most_concentrated_authority" ? "authority changes" : "target changes" })),
      ...(s.assumptions.underwriter.withdrawal ? [{ x: s.assumptions.underwriter.withdrawal.day, label: "withdrawal tried" }] : []),
    ];
    out[`charts/${s.id}.svg`] = lineChart({
      title: `${s.title}: capital against what the rules ask for`,
      desc: `The run with the median ending capital out of ${sum.runs} (seed ${sum.representativeSeed}). Capital in the book, the capital the k rule needs against the limits sold, and claims owed but unpaid, in NEAR, over ${sr.length} days.`,
      xLabel: "day",
      yLabel: "NEAR",
      yMin: 0,
      markers,
      series: [
        { name: "capital in the book", color: "#1f6feb", points: sr.map((p) => ({ x: p.day, y: p.capitalNear })) },
        { name: "capital the k rule needs", color: "#6e7781", dash: "6 4", points: sr.map((p) => ({ x: p.day, y: p.requiredNear })) },
        { name: "claims owed, unpaid", color: "#d1242f", points: sr.map((p) => ({ x: p.day, y: p.unpaidNear })) },
      ],
    });
  }
  out["charts/insolvency.svg"] = barChart({
    title: "Probability that a claim goes unpaid for want of capital, by scenario",
    desc: `Share of ${assumptions.runsPerScenario} seeded runs per scenario in which the pool refused at least one claim for want of capital, with the 95% Wilson interval.`,
    yLabel: "runs with an unpaid claim",
    hLine: { y: derivation.bound, label: `bound ${pct(derivation.bound, 0)}` },
    bars: sums.map((s) => ({ label: BAR_LABEL[s.id] ?? s.title, value: s.probabilityInsolvency.p, lo: s.probabilityInsolvency.lo, hi: s.probabilityInsolvency.hi, color: s.id === "insufficient_capital" ? "#d1242f" : s.id.includes("without_lock") ? "#bf8700" : "#1f6feb" })),
  });
  const cs = derivation.concentration[0];
  out["charts/concentration-sweep.svg"] = lineChart({
    title: "Probability of an unpaid claim against the concentration limit",
    desc: `Book capital ${derivation.capitalNear} NEAR, k fixed at 5. Each point is ${derivation.runsPerCell} seeded runs. The mass correlated claim is the scenario that sets the limit.`,
    xLabel: "limit on one code hash or upgrade authority, times the book's capital",
    yLabel: "P(unpaid claim)",
    yMin: 0,
    hLine: { y: derivation.bound, label: "bound" },
    series: ["normal", "single_target_changes", "correlated_mass_claims"].map((id, i) => ({
      name: { normal: "normal", single_target_changes: "one target changes", correlated_mass_claims: "mass correlated claims" }[id]!,
      color: ["#1f6feb", "#bf8700", "#d1242f"][i],
      dash: ["", "6 4", ""][i] || undefined,
      points: cs.cells.filter((c) => c.scenario === id).map((c) => ({ x: c.value, y: c.p })),
    })),
  });

  out["REPORT.md"] = report(assumptions, sums, derivation, series);
  return out;
}

function report(a: AssumptionsFile, sums: ScenarioSummary[], d: Derivation, series: Record<string, { seed: number; series: DayPoint[] }>): string {
  const base = a.scenarios[0].assumptions;
  const L: string[] = [];
  L.push(`# Pool solvency simulation, ${a.date}`);
  L.push("");
  L.push(`**Every number below follows from assumptions listed in this file. None is measured.** In particular the chance that a contract changes (\`P(event)\`) is the pool's own declared **underwriting assumption**, not a measurement: how often NEAR contracts change code is open question 1 (\`docs/DECISIONS.md\`), and it gates mainnet coverage (release gate B). These results are for testnet design only.`);
  L.push("");
  L.push(`${base.agents} agents over ${base.days} days, ${a.runsPerScenario} seeded runs per scenario (seeds ${a.firstSeed} to ${a.firstSeed + a.runsPerScenario - 1}). The pool's premium, capital adequacy, concentration, release, payout and withdrawal-lock rules are the contract's (\`contracts/pool\`), held to it by golden vectors the pool's own test regenerates. Everything else is a modelling assumption, listed below. One command rebuilds this file and every chart from \`raw/\`: \`pnpm --filter @aruna/sim sim\`.`);
  L.push("");
  L.push("## Outputs");
  L.push("");
  L.push(`"Insolvent" means the pool refused at least one claim because the claim was larger than the book's capital (the contract pays all of a claim or none of it). A claim refused for want of capital is retried daily, so premium income can pay it later: "most owed and unpaid at once" keeps that failure visible when "unpaid at the end" has healed. "Solvency ratio" is capital divided by claims still unpaid plus the remaining limits of coverage still open, at the end; it is against the limits, the most that could be claimed, so it sits below 1 by design (the adequacy rule keeps it at or above ${(100 / Number(a.poolParams.kX100)).toFixed(1)} while it binds). Drawdown is of capital per share, so withdrawals do not count. Medians over runs unless stated.`);
  L.push("");
  L.push(table(
    ["Scenario", "P(insolvent), 95% interval", "Ending capital, NEAR (5th to 95th)", "Claims paid, NEAR", "Most owed and unpaid at once, NEAR", "Unpaid at the end, NEAR", "Solvency ratio", "Max drawdown", "Time to insolvency, days"],
    sums.map((s) => [s.title, ci(s.probabilityInsolvency), `${n0(s.endingCapitalNear.median)} (${n0(s.endingCapitalNear.p5)} to ${n0(s.endingCapitalNear.p95)})`, n0(s.claimsPaidNear.median), `${n0(s.peakUnpaidNear.median)} (95th: ${n0(s.peakUnpaidNear.p95)})`, `${n0(s.claimsUnpaidNear.median)} (95th: ${n0(s.claimsUnpaidNear.p95)})`, s.solvencyRatio.median === null ? "none outstanding" : `${s.solvencyRatio.median} (5th: ${s.solvencyRatio.p5})`, pct(s.maxDrawdown.median), s.timeToInsolvencyDays.median === null ? "never" : `${s.timeToInsolvencyDays.median} (${s.timeToInsolvencyDays.insolventRuns} runs)`]),
  ));
  L.push("");
  L.push("![Probability of an unpaid claim by scenario](charts/insolvency.svg)");
  L.push("");
  const brk = a.scenarios.find((s) => s.breaksThePool);
  if (brk) {
    const s = sums.find((x) => x.id === brk.id)!;
    L.push("## The scenario that breaks the pool");
    L.push("");
    const peakLimits = Math.max(...series["normal"].series.map((p) => p.totalLimitsNear));
    L.push(`${brk.note} In the normal scenario the book's limits peak at ${n0(peakLimits)} NEAR, which is what the agents buy when nothing limits them.`);
    L.push("");
    const ev = (brk.assumptions.events.scripted as { day: number }[])[0];
    const ref = sums.find((x) => x.id === "correlated_mass_claims");
    L.push(`It breaks the pool in ${pct(s.probabilityInsolvency.p, 0)} of runs. The first unpaid claim comes a median of ${s.timeToInsolvencyDays.median} days in; the event is on day ${ev.day}. At its worst a median of ${n0(s.peakUnpaidNear.median)} NEAR (95th: ${n0(s.peakUnpaidNear.p95)}) was owed and unpaid at once. Because refused claims are retried daily, premium income pays part of it later: at the end ${n0(s.claimsUnpaidNear.median)} NEAR (95th: ${n0(s.claimsUnpaidNear.p95)}) is still unpaid, with ${n0(s.endingCapitalNear.median)} NEAR left in the book. It is shown as it happens, not tuned to look better.${ref ? ` For comparison, the mass correlated claims scenario has the same kind of event with the rules on and ${n0(a.scenarios.find((x) => x.id === ref.id)!.assumptions.pool.startingCapitalNear)} NEAR of starting capital, and P(insolvent) there is ${pct(ref.probabilityInsolvency.p)}. That compares two things that differ in both the rules and the capital, so it does not say which of the two matters more.` : ""}`);
    L.push("");
    L.push(`![${brk.title}](charts/${brk.id}.svg)`);
    L.push("");
  }
  const wd = sums.find((s) => s.id === "underwriter_withdrawal");
  const wn = sums.find((s) => s.id === "underwriter_withdrawal_without_lock");
  if (wd && wn?.withdrawal && wd.withdrawal) {
    L.push("## Underwriter withdrawal: the lock is what stops it");
    L.push("");
    L.push(`The contract refuses a withdrawal until every coverage in the book is past its end plus its reporting period, and every purchase pushes that date out. In this model agents renew continuously, so the book is never fully idle: the underwriter's withdrawal succeeded in **${wd.withdrawal.runsExecuted} of ${wd.runs}** runs, with a mean of ${wd.withdrawal.meanRefusedAttempts} refused attempts. Without the lock (a counterfactual, **not** the contract) it succeeds immediately in ${wn.withdrawal.runsExecuted} of ${wn.runs} runs, takes ${wn.withdrawal.medianAmountNearWhenExecuted === null ? "nothing" : n0(wn.withdrawal.medianAmountNearWhenExecuted) + " NEAR"}, and ending capital falls from ${n0(wd.endingCapitalNear.median)} to ${n0(wn.endingCapitalNear.median)} NEAR; ${n0(wn.purchasesRefusedMean.capital_adequacy)} purchases on average are then refused by the adequacy rule. The lock also means capital cannot be pulled before a correlated event. The price is that underwriters cannot leave while the market is active; the model does not say whether anyone would underwrite on those terms.`);
    L.push("");
  }
  L.push("## Derived values");
  L.push("");
  L.push(`Rule: ${d.rule}. Bound: P(insolvency) at or under ${pct(d.bound, 0)}. Book capital ${d.capitalNear} NEAR, which wants far more coverage than it may sell, so that the limits bind. ${d.runsPerCell} runs per cell. The rule was fixed after an exploratory run showed that two scenarios never bind; it is not a prediction made in advance.`);
  L.push("");
  L.push(`### Concentration limit`);
  L.push("");
  const never = (id: string) => d.concentration[0].cells.filter((c) => c.scenario === id).every((c) => c.withinBound);
  const scenName: Record<string, string> = { normal: "normal operation", single_target_changes: "one target changing", correlated_mass_claims: "the mass correlated claim" };
  const free = Object.keys(scenName).filter(never).map((id) => scenName[id]);
  const binding = Object.keys(scenName).filter((id) => !never(id)).map((id) => scenName[id]);
  L.push(`**Derived: ${d.concentrationLimit === null ? "none, even the smallest value fails" : `${d.concentrationLimit} x capital`}** (the contract's declared value is ${Number(a.poolParams.concentrationBps) / 10_000} x). Largest value, with every smaller value also within the bound in all three scenarios. ${free.length ? `Stays under the bound at every value tried: ${free.join(" and ")}. ` : ""}${binding.length ? `Goes over the bound at some value: ${binding.join(" and ")}${binding.length === 1 && binding[0] === "the mass correlated claim" ? ", where one upgrade authority changes everything it controls" : ""}.` : "No scenario goes over the bound at any value tried."}`);
  L.push("");
  if (d.concentrationLimit !== null) {
    const at = d.concentration[0].cells.filter((c) => c.value === d.concentrationLimit);
    const worst = at.reduce((x, y) => (y.p > x.p ? y : x));
    L.push(`At ${d.concentrationLimit} x the worst scenario's estimate is ${pct(worst.p)} (95% interval ${pct(worst.lo)} to ${pct(worst.hi)}) against a bound of ${pct(d.bound, 0)}.${worst.hi > d.bound ? " The interval reaches above the bound, so treat this value as the edge of what the runs support, not as a safe margin; the next value down in the grid is the conservative reading." : ""}`);
    L.push("");
  }
  L.push(sweepTable(d.concentration[0]));
  L.push("");
  L.push("![Concentration sweep](charts/concentration-sweep.svg)");
  L.push("");
  L.push("Sensitivity to the unmeasured P(event): the same derivation when changes are more frequent than the pool assumes.");
  L.push("");
  L.push(table(["P(event) multiplier", "Derived concentration limit, x capital"], d.concentration.map((s) => [`x${s.pEventMultiplier}`, s.derived === null ? "none" : `${s.derived}`])));
  L.push("");
  L.push("### k, the capital adequacy factor");
  L.push("");
  const k = d.k[0];
  L.push(d.kIdentified ? `**Derived: ${k.derived} x capital**.` : `**Not derived at the declared P(event).** These scenarios do not identify \`k\` there: with the concentration limit at ${d.concentrationLimit} x, P(insolvency) is within the bound in every scenario at every \`k\` tried, up to ${k.cells[k.cells.length - 1].value}. A likely reason, not tested here, is that the concentration limit caps the loss from any one hash or authority before \`k\` can matter; \`k\` bounds the total across many targets, which would matter when several unrelated authorities change together, and that needs a systemic-event scenario and a measured drift frequency, neither of which exists yet. The contract keeps \`k\` = ${Number(a.poolParams.kX100) / 100}; this result is no evidence for that value and no reason to change it.`);
  L.push("");
  L.push(sweepTable(k));
  L.push("");
  L.push(table(["P(event) multiplier", "Largest k within the bound in all scenarios", "Bound holds at the top of the grid"], d.k.map((s) => [`x${s.pEventMultiplier}`, s.derived === null ? "none" : `${s.derived}`, s.notIdentified ? "yes" : "no"])));
  L.push("");
  const stressed = d.k.filter((s) => s.pEventMultiplier > 1 && !s.notIdentified);
  if (!d.kIdentified && stressed.length) {
    L.push(`Under stress \`k\` is identified: ${stressed.map((s) => `at ${s.pEventMultiplier}x the declared P(event), the largest \`k\` within the bound is ${s.derived === null ? "none (even the smallest fails)" : s.derived}`).join("; ")}. These runs keep the concentration limit at ${d.concentrationLimit} x, the value derived at the declared P(event), not the value each stress would derive. The declared P(event) is not measured, so a \`k\` that is safe only if it is right is not yet a \`k\` to lock (release gate B asks for the measured frequency first).`);
  }
  L.push("");
  L.push("## What the model assumes");
  L.push("");
  L.push("Each scenario's full input is in `assumptions.json`. The basis case, shared by all of them:");
  L.push("");
  L.push(table(["Assumption", "Value", "Kind"], [
    ["agents, days", `${base.agents}, ${base.days}`, "plan"],
    ["P(event) per 30 days, by class", `immutable ${base.pool.params.pEventBps30d.immutable_verified} bps, local ${base.pool.params.pEventBps30d.local_upgradeable} bps, global ${base.pool.params.pEventBps30d.global_by_account} bps`, "**UNDERWRITING ASSUMPTION** (the pool's own; not measured)"],
    ["targets", `${base.implementations.length} implementations under ${new Set(base.implementations.map((i: { authority: number }) => i.authority)).size} upgrade authorities; agent picks target j with weight 1/(j+1)^${base.zipfExponent}`, "modelling"],
    ["each agent's daily cap", `lognormal, median ${base.dailyCapNear.median} NEAR, sigma ${base.dailyCapNear.sigma}`, "modelling"],
    ["share of cap actually spent per day", `uniform ${base.utilizationBps.min / 100}% to ${base.utilizationBps.max / 100}%`, "modelling"],
    ["coverage", `${base.coverage.windowDays}-day window, payout ratio ${base.coverage.payoutRatioBps / 100}%, limit = the most the cap can reach; renews with probability ${base.coverage.renewProbability}; first purchases spread over ${base.coverage.purchaseSpreadDays} days; refused purchases retried daily up to ${base.coverage.maxBuyAttempts} times`, "modelling"],
    ["starting capital (basis)", `${n0(base.pool.startingCapitalNear)} NEAR from one underwriter`, "modelling"],
    ["after a change", `target frozen for ${base.events.freezeDays} days: no new coverage on it`, "modelling"],
    ["claims", `report ${base.claims.detectDelayBlocks} blocks after the change, challenge window ${base.claims.challengeWindowBlocks} blocks, filed within ${base.claims.claimDelayMaxBlocks} blocks after; a claim refused for want of capital is retried daily`, "modelling"],
    ["pool rules: k, concentration, margin, capital cost, waiting period, reporting period", `${Number(a.poolParams.kX100) / 100}, ${Number(a.poolParams.concentrationBps) / 10_000} x, ${a.poolParams.riskMarginBps} bps, ${a.poolParams.capitalCostBps30d} bps, ${a.poolParams.waitingPeriodBlocks} blocks, ${a.poolParams.claimReportingBlocks} blocks`, "the contract's declared values (also assumptions, `contracts/common/src/params.rs`)"],
  ]));
  L.push("");
  L.push("Not modelled: who may buy (vault, policy, class record, attestor heartbeat), disputes and the arbiter, the attestor being wrong or late beyond a fixed delay, several underwriters, several tokens, premium discounts, and any change in agents' behaviour after a loss. Exposure accrues evenly across the day. One implementation changing again after its freeze is allowed; the new code hash starts a new concentration bucket.");
  L.push("");
  return L.join("\n") + "\n";
}
