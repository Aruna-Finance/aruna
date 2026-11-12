// The population model (plan U17, R41, R42): agents buy coverage from one pool book, targets change,
// claims are filed and paid, an underwriter may try to withdraw. Every pool rule is `rules.ts`, which is
// held to the contract by golden vectors. Everything else here is an ASSUMPTION about the world, and each
// one is a field of `Assumptions`, printed into every result file. Nothing is measured: the drift frequency
// of NEAR contracts is open question 1 (docs/DECISIONS.md), and P(event) below is the pool's own
// declared underwriting assumption, not data.
//
// Seeded and deterministic: the same assumptions and seed give the same run, byte for byte.
import { Book, CONTRACT_PARAMS, quote, type BookOptions, type InsurableClass, type PoolParams } from "./rules.js";

export interface Implementation {
  class: InsurableClass;
  /** Which upgrade authority can change it. Two implementations with one authority change together when it does. */
  authority: number;
}

export interface ScriptedEvent {
  day: number;
  /** An implementation changes (the most exposed one), or every implementation under one authority (the most concentrated). */
  kind: "most_exposed_implementation" | "most_concentrated_authority";
}

export interface Assumptions {
  agents: number;
  days: number;
  /** The targets agents use, most popular first. */
  implementations: Implementation[];
  /** Agent i picks implementation j with weight 1 / (j + 1)^zipfExponent. */
  zipfExponent: number;
  /** Each agent's daily spend cap in NEAR, lognormal. */
  dailyCapNear: { median: number; sigma: number };
  /** What share of its cap an agent actually spends each day, uniform between these (basis points). */
  utilizationBps: { min: number; max: number };
  coverage: {
    windowDays: number;
    payoutRatioBps: number;
    /** Chance an agent buys again when its coverage ends. */
    renewProbability: number;
    /** First purchases are spread uniformly over this many days. */
    purchaseSpreadDays: number;
    /** A refused purchase is tried again each day, this many times. */
    maxBuyAttempts: number;
  };
  pool: {
    startingCapitalNear: number;
    params: PoolParams;
    book: BookOptions;
  };
  events: {
    /** Multiplies the contract's declared P(event) per class. 1 is the pool's own assumption. */
    pEventMultiplier: number;
    scripted: ScriptedEvent[];
    /** After a change the target is frozen, and nobody can buy coverage on it, for this many days. */
    freezeDays: number;
  };
  claims: {
    /** Blocks from the change to the attestor's report reaching the registry. */
    detectDelayBlocks: number;
    challengeWindowBlocks: number;
    /** Each claim is filed uniformly within this many blocks after its report is verified. */
    claimDelayMaxBlocks: number;
    /** A claim refused for want of capital is tried again each day. */
    retryUnpaidDaily: boolean;
  };
  underwriter: {
    /** At `day`, the underwriter tries to withdraw this share of its shares, daily until it works. */
    withdrawal: { day: number; shareBps: number } | null;
  };
}

/** Basis case. Every number is a stated assumption: see `docs` in the results and `packages/sim/README.md`. */
export function baseAssumptions(): Assumptions {
  return {
    agents: 200,
    days: 60,
    implementations: [
      { class: "local_upgradeable", authority: 0 },
      { class: "local_upgradeable", authority: 1 },
      { class: "global_by_account", authority: 0 },
      { class: "local_upgradeable", authority: 2 },
      { class: "immutable_verified", authority: 3 },
      { class: "local_upgradeable", authority: 4 },
      { class: "global_by_account", authority: 0 },
      { class: "local_upgradeable", authority: 5 },
      { class: "immutable_verified", authority: 6 },
      { class: "local_upgradeable", authority: 7 },
      { class: "global_by_account", authority: 1 },
      { class: "local_upgradeable", authority: 2 },
    ],
    zipfExponent: 1,
    dailyCapNear: { median: 2, sigma: 0.8 },
    utilizationBps: { min: 3_000, max: 9_000 },
    coverage: { windowDays: 30, payoutRatioBps: 8_000, renewProbability: 0.8, purchaseSpreadDays: 30, maxBuyAttempts: 7 },
    pool: { startingCapitalNear: 3_000, params: CONTRACT_PARAMS, book: {} },
    events: { pEventMultiplier: 1, scripted: [], freezeDays: 5 },
    claims: { detectDelayBlocks: 60, challengeWindowBlocks: 300, claimDelayMaxBlocks: 43_200, retryUnpaidDaily: true },
    underwriter: { withdrawal: null },
  };
}

export interface DayPoint {
  day: number;
  capitalNear: number;
  totalLimitsNear: number;
  /** What the adequacy rule asks the book to hold against its limits: limits x 100 / k x 100. */
  requiredNear: number;
  unpaidNear: number;
  paidNear: number;
  navPerShare: number;
  openCoverages: number;
}

export interface RunSummary {
  seed: number;
  endingCapitalNear: number;
  claimsPaidNear: number;
  claimsPaidCount: number;
  /** Claims the pool could not pay for want of capital and had not paid by the end. */
  claimsUnpaidNear: number;
  claimsUnpaidCount: number;
  /** The most claims were owed and unpaid at once, at any time. A claim retried and paid later still counts here. */
  peakUnpaidNear: number;
  /** capital / (unpaid claims + the remaining limits of coverage still open). Null when there is nothing outstanding. */
  solvencyRatio: number | null;
  /** The largest fall of capital per share from its running peak. Withdrawals do not count: they leave pro rata. */
  maxDrawdown: number;
  /** True when a claim was refused for want of capital at any time, even if paid later. */
  insolvent: boolean;
  timeToInsolvencyDays: number | null;
  changes: number;
  coveragesBought: number;
  purchasesRefused: { capital_adequacy: number; concentration: number; frozen: number };
  premiumsNear: number;
  withdrawal: { attemptedDay: number; executedDay: number | null; refusedAttempts: number; amountNear: number } | null;
}

export interface RunResult {
  summary: RunSummary;
  series: DayPoint[];
}

// ---- helpers ------------------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEAR = 10n ** 24n;
/** NEAR as yoctoNEAR, to micro-NEAR resolution. */
const near = (x: number): bigint => BigInt(Math.round(x * 1e6)) * 10n ** 18n;
const toNear = (y: bigint): number => Number(y / 10n ** 15n) / 1e9;

interface Agent {
  impl: number;
  cap: bigint;
  utilBps: bigint;
  coverage: number | null;
}
interface Pending {
  key: string;
  coverage: number;
  changedAt: number;
  wanted: bigint;
}
type Ev = { block: number; seq: number; run: () => void };

export function simulate(a: Assumptions, seed: number): RunResult {
  const rnd = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-12))) * Math.cos(2 * Math.PI * rnd());
  const BPD = a.pool.params.blocksPerDay;
  const horizon = a.days * BPD;
  const book = new Book(a.pool.params, a.pool.book);
  const UNDERWRITER = "underwriter";
  book.deposit(UNDERWRITER, near(a.pool.startingCapitalNear));

  // --- the population ---
  const weights = a.implementations.map((_, j) => 1 / Math.pow(j + 1, a.zipfExponent));
  const wTotal = weights.reduce((s, w) => s + w, 0);
  const pickImpl = () => {
    let x = rnd() * wTotal;
    for (let j = 0; j < weights.length; j++) {
      x -= weights[j];
      if (x <= 0) return j;
    }
    return weights.length - 1;
  };
  const agents: Agent[] = Array.from({ length: a.agents }, () => ({
    impl: pickImpl(),
    cap: near(Math.max(0.05, a.dailyCapNear.median * Math.exp(a.dailyCapNear.sigma * normal()))),
    utilBps: BigInt(Math.round(a.utilizationBps.min + rnd() * (a.utilizationBps.max - a.utilizationBps.min))),
    coverage: null,
  }));
  const version = a.implementations.map(() => 0);
  const frozenUntil = a.implementations.map(() => 0);
  const hashOf = (j: number) => `impl${j}.v${version[j]}`;
  const authorityOf = (j: number) => `authority${a.implementations[j].authority}`;
  // The vault's exposure_before(b): linear spending at the agent's utilization of its cap.
  const exposureBefore = (ag: Agent, b: number): bigint => (ag.cap * ag.utilBps * BigInt(b)) / (10_000n * BigInt(BPD));
  const coverageAgent = new Map<number, Agent>();
  const coverageImpl = new Map<number, number>();

  // --- the clock ---
  const queue: Ev[] = [];
  let seq = 0;
  const at = (block: number, run: () => void) => {
    if (block >= horizon) return;
    const ev = { block, seq: seq++, run };
    let i = queue.length;
    while (i > 0 && (queue[i - 1].block < block || (queue[i - 1].block === block && queue[i - 1].seq < ev.seq))) i--;
    queue.splice(i, 0, ev); // kept sorted, latest first, so pop() is the next event
  };

  // --- state the metrics read ---
  const pending = new Map<string, Pending>();
  let paid = 0n;
  let paidCount = 0;
  let premiums = 0n;
  let bought = 0;
  let changes = 0;
  const refused = { capital_adequacy: 0, concentration: 0, frozen: 0 };
  let insolventAt: number | null = null;
  let peakUnpaid = 0n;
  let peakNav = 1;
  let maxDrawdown = 0;
  const nav = () => (book.totalShares === 0n ? 1 : Number((book.capital * 1_000_000_000n) / book.totalShares) / 1e9);
  const trackNav = () => {
    const v = nav();
    if (v > peakNav) peakNav = v;
    if (peakNav > 0) maxDrawdown = Math.max(maxDrawdown, (peakNav - v) / peakNav);
  };
  const series: DayPoint[] = [];
  const withdrawal = a.underwriter.withdrawal ? { attemptedDay: a.underwriter.withdrawal.day, executedDay: null as number | null, refusedAttempts: 0, amountNear: 0 } : null;

  // --- purchases ---
  const tryBuy = (ag: Agent, block: number, attempt: number) => {
    if (block >= frozenUntil[ag.impl] && block < horizon) {
      const days = Math.ceil((a.coverage.windowDays * BPD) / BPD) + 1;
      const limit = (ag.cap * BigInt(days) * BigInt(a.coverage.payoutRatioBps)) / 10_000n;
      const req = { class: a.implementations[ag.impl].class, hash: hashOf(ag.impl), authority: authorityOf(ag.impl), limit, dailyCap: ag.cap, payoutRatioBps: a.coverage.payoutRatioBps, windowBlocks: a.coverage.windowDays * BPD };
      const q = quote(a.pool.params, req.class, req.limit, req.payoutRatioBps, req.windowBlocks, req.dailyCap);
      const r = q ? book.buy(block, req, q.premium) : null;
      if (r?.accepted) {
        const c = book.coverages[r.id];
        ag.coverage = r.id;
        coverageAgent.set(r.id, ag);
        coverageImpl.set(r.id, ag.impl);
        premiums += r.premium;
        bought++;
        trackNav();
        if (rnd() < a.coverage.renewProbability) at(c.endBlock, () => tryBuy(ag, c.endBlock, 0));
        return;
      }
      if (r && !r.accepted && (r.reason === "capital_adequacy" || r.reason === "concentration")) refused[r.reason]++;
    } else {
      refused.frozen++;
    }
    if (attempt + 1 < a.coverage.maxBuyAttempts) at(block + BPD, () => tryBuy(ag, block + BPD, attempt + 1));
  };

  // --- claims ---
  const attemptClaim = (p: Pending, block: number) => {
    const c = book.coverages[p.coverage];
    const ag = coverageAgent.get(p.coverage)!;
    const r = book.claim(p.coverage, p.changedAt, exposureBefore(ag, p.changedAt), exposureBefore(ag, c.paidThroughBlock));
    if (r.outcome === "paid") {
      paid += r.paid;
      paidCount++;
      pending.delete(p.key);
      trackNav();
    } else if (r.outcome === "book capital is insufficient") {
      if (insolventAt === null) insolventAt = block;
      pending.set(p.key, { ...p, wanted: r.wanted });
      let owed = 0n;
      for (const q of pending.values()) owed += q.wanted;
      if (owed > peakUnpaid) peakUnpaid = owed;
      if (a.claims.retryUnpaidDaily) at(block + BPD, () => attemptClaim(p, block + BPD));
    } else pending.delete(p.key);
  };

  // --- changes ---
  const change = (impls: number[], block: number) => {
    changes += impls.length;
    for (const j of impls) {
      const before = hashOf(j);
      version[j]++;
      frozenUntil[j] = block + a.events.freezeDays * BPD;
      for (const c of book.coverages) {
        if (c.released || c.request.hash !== before || block > c.endBlock) continue;
        const p: Pending = { key: `${c.id}:${block}`, coverage: c.id, changedAt: block, wanted: 0n };
        const filed = block + a.claims.detectDelayBlocks + a.claims.challengeWindowBlocks + 1 + Math.floor(rnd() * a.claims.claimDelayMaxBlocks);
        at(filed, () => attemptClaim(p, filed));
      }
    }
  };
  const openLimits = (block: number) => book.coverages.filter((c) => !c.released && c.endBlock > block);
  const mostExposedImplementation = (block: number): number => {
    const by = new Map<number, bigint>();
    for (const c of openLimits(block)) by.set(coverageImpl.get(c.id)!, (by.get(coverageImpl.get(c.id)!) ?? 0n) + c.request.limit);
    return [...by].sort((x, y) => (x[1] === y[1] ? x[0] - y[0] : x[1] > y[1] ? -1 : 1))[0]?.[0] ?? 0;
  };
  const mostConcentratedAuthority = (block: number): number[] => {
    const by = new Map<number, bigint>();
    for (const c of openLimits(block)) {
      const au = a.implementations[coverageImpl.get(c.id)!].authority;
      by.set(au, (by.get(au) ?? 0n) + c.request.limit);
    }
    const top = [...by].sort((x, y) => (x[1] === y[1] ? x[0] - y[0] : x[1] > y[1] ? -1 : 1))[0]?.[0];
    return a.implementations.map((im, j) => (im.authority === top ? j : -1)).filter((j) => j >= 0);
  };

  // --- each day ---
  const pDaily = a.implementations.map((im) => 1 - Math.pow(1 - Math.min(1, (a.pool.params.pEventBps30d[im.class] * a.events.pEventMultiplier) / 10_000), 1 / 30));
  const day = (d: number) => {
    const start = d * BPD;
    a.implementations.forEach((_, j) => {
      if (rnd() < pDaily[j]) {
        const when = start + Math.floor(rnd() * BPD);
        at(when, () => change([j], when));
      }
    });
    for (const s of a.events.scripted) {
      if (s.day !== d) continue;
      const when = start + BPD / 4;
      at(when, () => change(s.kind === "most_exposed_implementation" ? [mostExposedImplementation(when)] : mostConcentratedAuthority(when), when));
    }
    // The keeper: anyone may call release_expired, and here someone does, once a day.
    at(start, () => {
      const ids = book.coverages.filter((c) => !c.released && start >= c.endBlock + a.pool.params.claimReportingBlocks).map((c) => c.id);
      if (ids.length) book.releaseExpired(start, ids);
    });
    if (a.underwriter.withdrawal && d >= a.underwriter.withdrawal.day && withdrawal && withdrawal.executedDay === null) {
      at(start + 1, () => {
        const w = a.underwriter.withdrawal!;
        const shares = (book.sharesOf(UNDERWRITER) * BigInt(w.shareBps)) / 10_000n;
        const r = book.withdraw(UNDERWRITER, shares, start + 1);
        if (r.ok) {
          withdrawal.executedDay = d;
          withdrawal.amountNear = toNear(r.amount);
        } else withdrawal.refusedAttempts++;
      });
    }
    at(start + BPD - 1, () => {
      let unpaid = 0n;
      for (const p of pending.values()) unpaid += p.wanted;
      series.push({
        day: d + 1,
        capitalNear: toNear(book.capital),
        totalLimitsNear: toNear(book.totalLimits),
        requiredNear: toNear((book.totalLimits * 100n) / a.pool.params.kX100),
        unpaidNear: toNear(unpaid),
        paidNear: toNear(paid),
        navPerShare: nav(),
        openCoverages: openLimits(start + BPD - 1).length,
      });
      trackNav();
    });
    if (d + 1 < a.days) at((d + 1) * BPD, () => day(d + 1));
  };

  // --- go ---
  agents.forEach((ag) => {
    const when = Math.floor(rnd() * a.coverage.purchaseSpreadDays * BPD);
    at(when, () => tryBuy(ag, when, 0));
  });
  at(0, () => day(0));
  while (queue.length) queue.pop()!.run();

  let unpaid = 0n;
  for (const p of pending.values()) unpaid += p.wanted;
  const open = openLimits(horizon - 1).reduce((s, c) => s + (c.request.limit - c.paidOut), 0n);
  const outstanding = unpaid + open;
  return {
    series,
    summary: {
      seed,
      endingCapitalNear: toNear(book.capital),
      claimsPaidNear: toNear(paid),
      claimsPaidCount: paidCount,
      claimsUnpaidNear: toNear(unpaid),
      claimsUnpaidCount: pending.size,
      peakUnpaidNear: toNear(peakUnpaid),
      solvencyRatio: outstanding === 0n ? null : Number((book.capital * 1_000_000n) / outstanding) / 1e6,
      maxDrawdown,
      insolvent: insolventAt !== null,
      timeToInsolvencyDays: insolventAt === null ? null : insolventAt / BPD,
      changes,
      coveragesBought: bought,
      purchasesRefused: refused,
      premiumsNear: toNear(premiums),
      withdrawal,
    },
  };
}

export { NEAR };
