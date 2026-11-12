import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAll } from "../src/build.js";
import { pickDerived } from "../src/derive.js";
import { generate } from "../src/generate.js";
import { baseAssumptions, simulate, type RunSummary } from "../src/model.js";
import { scenarios } from "../src/scenarios.js";
import { median } from "../src/stats.js";

const sc = (id: string) => scenarios().find((s) => s.id === id)!;
const runs = (id: string, n: number): RunSummary[] => Array.from({ length: n }, (_, i) => simulate(sc(id).assumptions, i + 1).summary);

describe("the model is deterministic", () => {
  it("the same assumptions and seed give the same run, series included; another seed does not", () => {
    const a = baseAssumptions();
    expect(simulate(a, 7)).toEqual(simulate(a, 7));
    expect(simulate(a, 7).summary.endingCapitalNear).not.toBe(simulate(a, 8).summary.endingCapitalNear);
  });

  it("is a population of 200 agents over 60 days, with a daily series of 60 points", () => {
    const r = simulate(baseAssumptions(), 1);
    expect(r.series).toHaveLength(60);
    expect(r.series[0].day).toBe(1);
    expect(r.series[59].day).toBe(60);
    expect(r.summary.coveragesBought).toBeGreaterThan(100);
  });
});

describe("the scenarios do what their names say", () => {
  it("the insufficient-capital scenario ends insolvent, with a time to insolvency at the event", () => {
    const s = runs("insufficient_capital", 60);
    const insolvent = s.filter((x) => x.insolvent);
    expect(insolvent.length / s.length).toBeGreaterThan(0.9);
    for (const x of insolvent) {
      expect(x.timeToInsolvencyDays).toBeGreaterThanOrEqual(30);
      expect(x.timeToInsolvencyDays).toBeLessThan(32);
      expect(x.peakUnpaidNear).toBeGreaterThan(0);
    }
  });

  it("with the adequacy and concentration rules on, the same pool sells less and is turned away by them", () => {
    const thin = baseAssumptions();
    thin.pool.startingCapitalNear = 100;
    const on = simulate(thin, 1).summary;
    thin.pool.book = { adequacy: false, concentration: false };
    const off = simulate(thin, 1).summary;
    expect(on.purchasesRefused.capital_adequacy + on.purchasesRefused.concentration).toBeGreaterThan(0);
    expect(off.purchasesRefused.capital_adequacy + off.purchasesRefused.concentration).toBe(0);
    expect(on.coveragesBought).toBeLessThan(off.coveragesBought);
  });

  it("the contract's lock refuses the underwriter's withdrawal every day it is tried; without it the withdrawal goes through on day 25", () => {
    const locked = runs("underwriter_withdrawal", 10);
    const open = runs("underwriter_withdrawal_without_lock", 10);
    for (const x of locked) {
      expect(x.withdrawal!.executedDay).toBeNull();
      expect(x.withdrawal!.refusedAttempts).toBeGreaterThan(30);
    }
    for (const x of open) {
      expect(x.withdrawal!.executedDay).toBe(25);
      expect(x.withdrawal!.amountNear).toBeGreaterThan(1000);
    }
  });

  it("a withdrawal followed by a correlated event leaves a lower solvency ratio than normal operation", () => {
    const normal = median(runs("normal", 40).map((x) => x.solvencyRatio!));
    const withdrawn = median(runs("underwriter_withdrawal_without_lock", 40).map((x) => x.solvencyRatio!));
    expect(withdrawn).toBeLessThan(normal);
  });

  it("a mass correlated claim costs far more than a single target changing, which costs more than nothing", () => {
    const paid = (id: string) => median(runs(id, 40).map((x) => x.claimsPaidNear));
    expect(paid("single_target_changes")).toBeGreaterThan(paid("normal"));
    expect(paid("correlated_mass_claims")).toBeGreaterThan(paid("single_target_changes"));
  });

  it("claims are all or nothing: capital never goes negative, even when claims are refused", () => {
    for (const x of runs("insufficient_capital", 30)) {
      expect(x.endingCapitalNear).toBeGreaterThanOrEqual(0);
    }
    const r = simulate(sc("insufficient_capital").assumptions, 1);
    for (const p of r.series) expect(p.capitalNear).toBeGreaterThanOrEqual(0);
  });
});

describe("the derivation rule", () => {
  const cell = (value: number, withinBound: boolean) => ({ value, withinBound });
  it("takes the largest value whose every smaller value is within the bound in every scenario", () => {
    const grid = [1, 2, 3, 4];
    expect(pickDerived(grid, grid.flatMap((v) => [cell(v, true), cell(v, true)]))).toBe(4);
    expect(pickDerived(grid, [cell(1, true), cell(1, true), cell(2, true), cell(2, false), cell(3, true), cell(3, true), cell(4, true), cell(4, true)])).toBe(1);
    expect(pickDerived(grid, [cell(1, false), cell(2, true), cell(3, true), cell(4, true)])).toBeNull();
  });

  it("a pass after a failure is never chosen, because with a noisy estimate it is luck", () => {
    const grid = [1, 2, 3];
    expect(pickDerived(grid, [cell(1, true), cell(2, false), cell(3, true)])).toBe(1);
  });
});

describe("a results directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "aruna-sim-"));
  generate(dir, { date: "2026-01-01", runs: 12, deriveRuns: 3 });

  it("lists every input assumption of every scenario, and names P(event) an underwriting assumption", () => {
    const a = JSON.parse(readFileSync(join(dir, "assumptions.json"), "utf8"));
    expect(a.scenarios.map((s: { id: string }) => s.id)).toEqual(scenarios().map((s) => s.id));
    for (const s of a.scenarios) {
      for (const key of ["agents", "days", "implementations", "zipfExponent", "dailyCapNear", "utilizationBps", "coverage", "pool", "events", "claims", "underwriter"]) expect(s.assumptions, `${s.id}.${key}`).toHaveProperty(key);
      expect(s.assumptions.pool.params.pEventBps30d).toEqual({ immutable_verified: 50, local_upgradeable: 500, global_by_account: 1000 });
    }
    const report = readFileSync(join(dir, "REPORT.md"), "utf8");
    expect(report).toMatch(/UNDERWRITING ASSUMPTION/);
    expect(report).toMatch(/None is measured/);
  });

  it("has the six outputs of R42 for every scenario, and the breaking scenario shown", () => {
    const sum = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
    for (const s of sum.scenarios) {
      for (const key of ["endingCapitalNear", "claimsPaidNear", "claimsUnpaidNear", "solvencyRatio", "maxDrawdown", "probabilityInsolvency", "timeToInsolvencyDays"]) expect(s, `${s.id}.${key}`).toHaveProperty(key);
    }
    expect(readFileSync(join(dir, "REPORT.md"), "utf8")).toMatch(/## The scenario that breaks the pool/);
    expect(existsSync(join(dir, "charts", "insufficient_capital.svg"))).toBe(true);
  });

  it("rebuilds every derived file from raw/ alone, byte for byte", () => {
    const built = buildAll(dir);
    expect(Object.keys(built)).toContain("REPORT.md");
    expect(Object.keys(built).filter((k) => k.startsWith("charts/")).length).toBe(scenarios().length + 2);
    for (const [rel, content] of Object.entries(built)) expect(readFileSync(join(dir, rel), "utf8"), rel).toBe(content);
  });

  it("a chart edited by hand no longer equals what raw/ produces", () => {
    const p = join(dir, "charts", "normal.svg");
    const was = readFileSync(p, "utf8");
    writeFileSync(p, was.replace("capital", "capitol"));
    expect(readFileSync(p, "utf8")).not.toBe(buildAll(dir)["charts/normal.svg"]);
    writeFileSync(p, was);
  });

  it("is deterministic: generating twice into two directories gives identical files", () => {
    const other = mkdtempSync(join(tmpdir(), "aruna-sim-"));
    generate(other, { date: "2026-01-01", runs: 12, deriveRuns: 3 });
    for (const rel of ["assumptions.json", "summary.json", "REPORT.md", "raw/derivation.json", "raw/runs-normal.jsonl", "charts/insolvency.svg"]) expect(readFileSync(join(other, rel), "utf8"), rel).toBe(readFileSync(join(dir, rel), "utf8"));
  });
});
