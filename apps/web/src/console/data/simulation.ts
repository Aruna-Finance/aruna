import { COVERAGE_ASSUME, DAY } from "./coverage";

// A PROTOTYPE of the pool model in docs/BUILD-PLAN.md stage 6, ported from the UI prototype. It is not a result
// from packages/sim, which is empty today. Every input below is an assumption, and the screen says so. When
// @aruna/sim exists, the screen reads its output and this file goes away.

export interface Scenario {
  title: string;
  note: string;
  dailyEventRate: number;
  massEvent: { day: number; share: number } | null;
  withdrawal: { day: number; share: number } | null;
  capital: number;
  rulesOff?: boolean;
}

export type ScenarioId = "normal" | "single" | "correlated" | "withdrawal" | "undercapitalized";

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  normal: { title: "Normal operation", note: "Independent, infrequent code changes across many implementations.", dailyEventRate: 0.002, massEvent: null, withdrawal: null, capital: 100_000 },
  single: { title: "One target changes", note: "One widely used implementation changes on day 20.", dailyEventRate: 0.001, massEvent: { day: 20, share: 0.14 }, withdrawal: null, capital: 100_000 },
  correlated: {
    title: "Correlated mass claim",
    note: "The most concentrated implementation changes, and every exposed agent claims together on day 30.",
    dailyEventRate: 0.001,
    massEvent: { day: 30, share: 1 },
    withdrawal: null,
    capital: 100_000,
  },
  withdrawal: {
    title: "Underwriter withdrawal",
    note: "Half the free capital leaves on day 25, then a mid-sized correlated event lands on day 40.",
    dailyEventRate: 0.001,
    massEvent: { day: 40, share: 0.5 },
    withdrawal: { day: 25, share: 0.5 },
    capital: 100_000,
  },
  undercapitalized: {
    title: "Capital not enough",
    note: "The pool starts thin, with no adequacy rule and no concentration limit. A correlated event breaks it.",
    dailyEventRate: 0.002,
    massEvent: { day: 18, share: 1 },
    withdrawal: null,
    capital: 14_000,
    rulesOff: true,
  },
};

export const SIM_ASSUME = {
  agents: 200,
  days: 60,
  implementations: 12,
  premiumRatePer30d: 0.027,
  exposureMedian: 450,
} as const;

export interface DayPoint {
  day: number;
  capital: number;
  required: number;
  paid: number;
  unpaid: number;
}

export interface SimResult {
  id: ScenarioId;
  series: DayPoint[];
  finalCapital: number;
  paid: number;
  unpaid: number;
  solvency: number;
  maxDrawdown: number;
  /** Zero-based day of the first shortfall, or null when every claim was paid. */
  insolventDay: number | null;
  policies: number;
  turnedAway: number;
}

/** A small seeded generator, so a given scenario and seed always draw the same run. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Policy {
  g: number;
  limit: number;
  exposure: number;
  claimed: boolean;
}

export function simulate(id: ScenarioId, seed: number, override: Partial<Pick<Scenario, "capital">> = {}): SimResult {
  const sc = { ...SCENARIOS[id], ...override };
  const rnd = mulberry(seed);
  const { agents, days, implementations: gens } = SIM_ASSUME;
  const k = COVERAGE_ASSUME.capitalAdequacyK;
  const concPct = COVERAGE_ASSUME.concentrationPct;
  const payoutRatio = COVERAGE_ASSUME.defaultPayoutBps / 10_000;
  const delay = Math.round(COVERAGE_ASSUME.challengeWindowSec / DAY);
  const premiumRate = SIM_ASSUME.premiumRatePer30d / 30;

  let capital = sc.capital;
  const book: Policy[] = [];
  const genLimit = new Array<number>(gens).fill(0);
  let totalLimit = 0;
  let turnedAway = 0;
  for (let i = 0; i < agents; i++) {
    const g = Math.min(gens - 1, Math.floor(gens * Math.pow(rnd(), 2.2)));
    const u1 = Math.max(rnd(), 1e-9);
    const u2 = rnd();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const limit = Math.exp(Math.log(SIM_ASSUME.exposureMedian) + 0.8 * z);
    if (!sc.rulesOff) {
      if (totalLimit + limit > capital * k) {
        turnedAway += 1;
        continue;
      }
      if (genLimit[g] + limit > capital * concPct) {
        turnedAway += 1;
        continue;
      }
    }
    genLimit[g] += limit;
    totalLimit += limit;
    book.push({ g, limit, exposure: limit * (0.4 + 0.6 * rnd()), claimed: false });
  }

  const series: DayPoint[] = [];
  const pending: { due: number; amount: number }[] = [];
  let paid = 0;
  let unpaid = 0;
  let peak = capital;
  let maxDD = 0;
  let insolventDay: number | null = null;

  const claim = (b: Policy, due: number) => {
    b.claimed = true;
    pending.push({ due, amount: Math.min(b.exposure * payoutRatio, b.limit) });
  };
  const claimOnGen = (g: number, due: number) => {
    for (const b of book) if (b.g === g && !b.claimed) claim(b, due);
  };

  for (let d = 0; d < days; d++) {
    const liveLimit = book.reduce((s, b) => s + (b.claimed ? 0 : b.limit), 0);
    capital += liveLimit * premiumRate;
    if (sc.withdrawal && d === sc.withdrawal.day) {
      const free = Math.max(0, capital - (sc.rulesOff ? 0 : liveLimit / k));
      capital -= free * sc.withdrawal.share;
    }
    if (rnd() < sc.dailyEventRate * gens) claimOnGen(Math.floor(rnd() * gens), d + delay);
    if (sc.massEvent && d === sc.massEvent.day) {
      const worst = genLimit.indexOf(Math.max(...genLimit));
      if (sc.massEvent.share >= 1) claimOnGen(worst, d + delay);
      else {
        for (const b of book) if (b.g === worst && !b.claimed && rnd() < sc.massEvent.share * 2) claim(b, d + delay);
      }
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].due > d) continue;
      const pay = Math.min(pending[i].amount, Math.max(0, capital));
      capital -= pay;
      paid += pay;
      const short = pending[i].amount - pay;
      if (short > 0.01) {
        unpaid += short;
        if (insolventDay == null) insolventDay = d;
      }
      pending.splice(i, 1);
    }
    peak = Math.max(peak, capital);
    maxDD = Math.max(maxDD, peak ? (peak - capital) / peak : 0);
    const remaining = book.reduce((s, b) => s + (b.claimed ? 0 : b.limit), 0);
    series.push({ day: d + 1, capital, required: remaining / k, paid, unpaid });
  }

  const last = series[series.length - 1];
  return {
    id,
    series,
    finalCapital: last.capital,
    paid,
    unpaid,
    solvency: last.required ? last.capital / last.required : Infinity,
    maxDrawdown: maxDD,
    insolventDay,
    policies: book.length,
    turnedAway,
  };
}

/** Many runs of one scenario with different seeds: how often the pool fails, and when. */
export function simulateMany(id: ScenarioId, runs = 200, override: Partial<Pick<Scenario, "capital">> = {}) {
  let insolvent = 0;
  const failDays: number[] = [];
  for (let i = 0; i < runs; i++) {
    const r = simulate(id, 1000 + i * 7, override);
    if (r.insolventDay != null) {
      insolvent += 1;
      failDays.push(r.insolventDay + 1);
    }
  }
  failDays.sort((a, b) => a - b);
  return { pInsolvent: insolvent / runs, medianDay: failDays.length ? failDays[Math.floor(failDays.length / 2)] : null };
}
