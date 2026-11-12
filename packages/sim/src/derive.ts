// Deriving the concentration limit, and asking whether `k` can be derived (plan U17, R43).
//
// The rule below was fixed AFTER an exploratory run showed that two of the three scenarios never bind, and
// is applied unchanged to every cell. It was not written before any number was seen:
//   bound   P(insolvency over 60 days) <= 1%, estimated over many seeded runs.
//   value   the LARGEST value v on the grid such that v and every smaller value on the grid keep the
//           probability at or under the bound in EVERY scenario tried. The plan says "the smallest values
//           that keep the probability ... under a stated bound"; a smaller concentration limit is always
//           safer, so the smallest is trivially the lowest on the grid. What is wanted is the most the
//           pool can sell while staying under the bound, which is the largest.
//   scenarios  normal, one target changes, and the mass correlated claim. The plan names the first two;
//           both stay at 0% for every value tried, so they cannot constrain anything. The third is the
//           one that does, so it is included.
//   capital   fixed at 1,000 NEAR, a book that wants far more coverage than it may sell, so the rule binds:
//           the limits are ratios of capital and mean something only while they bind.
import { baseAssumptions, simulate, type Assumptions } from "./model.js";
import { scenarios, type Scenario } from "./scenarios.js";
import { wilson } from "./stats.js";

export const BOUND = 0.01;
export const DERIVATION_CAPITAL_NEAR = 1_000;
export const DERIVATION_SCENARIOS = ["normal", "single_target_changes", "correlated_mass_claims"] as const;
export const CONC_GRID = [0.5, 0.75, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2, 3];
export const K_GRID = [2, 3, 4, 5, 6, 8, 10, 12, 16];
export const P_EVENT_MULTIPLIERS = [1, 2, 5];

export interface Cell {
  value: number;
  scenario: string;
  runs: number;
  insolvent: number;
  p: number;
  lo: number;
  hi: number;
  withinBound: boolean;
}
export interface Sweep {
  parameter: "concentration" | "k";
  /** Held fixed while this one varies. */
  fixed: Record<string, number>;
  pEventMultiplier: number;
  cells: Cell[];
  /** Largest grid value with every smaller one within the bound in every scenario; null if even the smallest fails. */
  derived: number | null;
  /** True when the largest value tried is itself within the bound: the bound never bit, so nothing is derived. */
  notIdentified: boolean;
}

const find = (id: string): Scenario => scenarios().find((s) => s.id === id)!;

function probability(a: Assumptions, runs: number): { insolvent: number; p: number; lo: number; hi: number } {
  let insolvent = 0;
  for (let seed = 1; seed <= runs; seed++) if (simulate(a, seed).summary.insolvent) insolvent++;
  const w = wilson(insolvent, runs);
  return { insolvent, p: w.p, lo: w.lo, hi: w.hi };
}

export function sweep(parameter: Sweep["parameter"], fixed: { k?: number; concentration?: number }, pEventMultiplier: number, runs: number): Sweep {
  const grid = parameter === "concentration" ? CONC_GRID : K_GRID;
  const cells: Cell[] = [];
  for (const value of grid) {
    for (const id of DERIVATION_SCENARIOS) {
      const a = structuredClone(find(id).assumptions);
      a.pool.startingCapitalNear = DERIVATION_CAPITAL_NEAR;
      a.events.pEventMultiplier = pEventMultiplier;
      const k = parameter === "k" ? value : (fixed.k ?? Number(baseAssumptions().pool.params.kX100) / 100);
      const conc = parameter === "concentration" ? value : (fixed.concentration ?? Number(baseAssumptions().pool.params.concentrationBps) / 10_000);
      a.pool.params = { ...a.pool.params, kX100: BigInt(Math.round(k * 100)), concentrationBps: BigInt(Math.round(conc * 10_000)) };
      const pr = probability(a, runs);
      cells.push({ value, scenario: id, runs, ...pr, withinBound: pr.p <= BOUND });
    }
  }
  const derived = pickDerived(grid, cells);
  const top = grid[grid.length - 1];
  return {
    parameter,
    fixed: { k: fixed.k ?? 5, concentration: fixed.concentration ?? 2, capitalNear: DERIVATION_CAPITAL_NEAR },
    pEventMultiplier,
    cells,
    derived,
    notIdentified: cells.filter((c) => c.value === top).every((c) => c.withinBound),
  };
}

/**
 * The largest grid value such that it, and every smaller one, is within the bound in every scenario. A value
 * past a failure is never chosen, even if it happens to pass: with a noisy estimate, a pass after a failure
 * is luck.
 */
export function pickDerived(grid: number[], cells: Pick<Cell, "value" | "withinBound">[]): number | null {
  let derived: number | null = null;
  for (const value of grid) {
    if (cells.filter((c) => c.value === value).every((c) => c.withinBound)) derived = value;
    else break;
  }
  return derived;
}

export interface Derivation {
  bound: number;
  capitalNear: number;
  runsPerCell: number;
  rule: string;
  concentration: Sweep[];
  k: Sweep[];
  /** conc* from the declared P(event). */
  concentrationLimit: number | null;
  kIdentified: boolean;
}

export function derive(runsPerCell: number): Derivation {
  const concentration = P_EVENT_MULTIPLIERS.map((m) => sweep("concentration", {}, m, runsPerCell));
  const concentrationLimit = concentration[0].derived;
  // k is swept with the concentration limit at the value just derived, so that it is not the concentration
  // limit's failure that shows up as k's.
  const k = P_EVENT_MULTIPLIERS.map((m) => sweep("k", { concentration: concentrationLimit ?? 1 }, m, runsPerCell));
  return {
    bound: BOUND,
    capitalNear: DERIVATION_CAPITAL_NEAR,
    runsPerCell,
    rule: "largest grid value v such that v and every smaller value keep P(insolvency over 60 days) at or under the bound in every scenario of normal, one target changes, mass correlated claims",
    concentration,
    k,
    concentrationLimit,
    kIdentified: !k[0].notIdentified,
  };
}
