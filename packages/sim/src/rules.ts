// The pool's own rules, re-implemented in BigInt (plan U17, KTD11). Nothing here is a modelling choice:
// it is `contracts/pool` (premium, capital adequacy, concentration, release, payout, withdrawal lock),
// and it is held to the real contract by `fixtures/golden/pool-rules.json`, which the pool's own test
// regenerates and `test/golden.test.ts` replays through this file. A rule change in the contract that is
// not made here fails one of the two. Amounts are yoctoNEAR as bigint, like the contract's u128.
//
// Not modelled, because they gate who may buy and not what the pool does with an accepted purchase: the
// vault record, the agent's policy, the target's class record and its attestor's heartbeat.

export type InsurableClass = "immutable_verified" | "local_upgradeable" | "global_by_account";
export type RiskClass = InsurableClass | "unknown";

export interface PoolParams {
  blocksPerDay: number;
  /** Capital adequacy `k`, times 100: total limits in a book must stay at or below k x capital. */
  kX100: bigint;
  /** Limits on one code hash, or one upgrade authority, in basis points of the book's capital. */
  concentrationBps: bigint;
  riskMarginBps: bigint;
  capitalCostBps30d: bigint;
  /** ASSUMPTION: P(event) per 30 days in basis points, by class. The contract's declared number, not a measurement. */
  pEventBps30d: Record<InsurableClass, number>;
  waitingPeriodBlocks: number;
  claimReportingBlocks: number;
  maxWindowBlocks: number;
}

/** `contracts/common/src/params.rs`. `test/golden.test.ts` fails if either side drifts. */
export const CONTRACT_PARAMS: PoolParams = {
  blocksPerDay: 43_200,
  kX100: 500n,
  concentrationBps: 20_000n,
  riskMarginBps: 2_000n,
  capitalCostBps30d: 100n,
  pEventBps30d: { immutable_verified: 50, local_upgradeable: 500, global_by_account: 1_000 },
  waitingPeriodBlocks: 120,
  claimReportingBlocks: 600,
  maxWindowBlocks: 30 * 43_200,
};

export interface Quote {
  days: number;
  reachable: bigint;
  expectedLoss: bigint;
  premium: bigint;
}

/** UTC days a window of `windowBlocks` can touch: ceil(window / blocksPerDay) + 1 (KTD3). */
export const daysTouched = (windowBlocks: number, blocksPerDay: number): number => Math.ceil(windowBlocks / blocksPerDay) + 1;

/** `pricing::quote`. Null when the class is not insurable. */
export function quote(p: PoolParams, cls: RiskClass, limit: bigint, payoutRatioBps: number, windowBlocks: number, dailyCap: bigint): Quote | null {
  if (cls === "unknown") return null;
  const pEvent = BigInt(p.pEventBps30d[cls]);
  const days = daysTouched(windowBlocks, p.blocksPerDay);
  const d = BigInt(days);
  const reachableRaw = (dailyCap * d * BigInt(payoutRatioBps)) / 10_000n;
  const reachable = reachableRaw < limit ? reachableRaw : limit;
  const el = (reachable * pEvent * d) / (30n * 10_000n);
  const margin = (el * p.riskMarginBps) / 10_000n;
  const capital = (reachable * p.capitalCostBps30d * d) / (30n * 10_000n);
  return { days, reachable, expectedLoss: el, premium: el + margin + capital };
}

export interface BuyRequest {
  class: RiskClass;
  hash: string;
  authority: string;
  limit: bigint;
  dailyCap: bigint;
  payoutRatioBps: number;
  windowBlocks: number;
}

export type BuyRefusal = "capital_adequacy" | "concentration" | "other";
export type BuyResult = { accepted: true; id: number; premium: bigint } | { accepted: false; reason: BuyRefusal; detail: string; premium: bigint };

export interface Coverage {
  id: number;
  request: BuyRequest;
  premium: bigint;
  startBlock: number;
  waitingPeriodEnds: number;
  endBlock: number;
  paidOut: bigint;
  /** Exposure up to this block was paid for or recorded before the purchase (D-62). */
  paidThroughBlock: number;
  released: boolean;
}

export type ClaimResult = { outcome: string; paid: bigint; wanted: bigint };

export interface BookOptions {
  /** The contract's adequacy rule. Off only in the scenario that shows what happens without it. */
  adequacy?: boolean;
  concentration?: boolean;
  /** The contract refuses withdrawals until every coverage's reporting period ends. Off only in a counterfactual. */
  lockEnforced?: boolean;
}

const mulDiv = (a: bigint, b: bigint, c: bigint) => (a * b) / c;
const sub = (a: bigint, b: bigint) => (a > b ? a - b : 0n);
const U128_MAX = (1n << 128n) - 1n;

/** One token's book of the pool: the state `contracts/pool` keeps for it. */
export class Book {
  capital = 0n;
  totalShares = 0n;
  totalLimits = 0n;
  lockedUntil = 0;
  readonly coverages: Coverage[] = [];
  private readonly byHash = new Map<string, bigint>();
  private readonly byAuthority = new Map<string, bigint>();
  private readonly shares = new Map<string, bigint>();

  constructor(
    readonly params: PoolParams = CONTRACT_PARAMS,
    readonly options: BookOptions = {},
  ) {}

  private get adequacy() {
    return this.options.adequacy ?? true;
  }
  private get concentration() {
    return this.options.concentration ?? true;
  }
  private get lockEnforced() {
    return this.options.lockEnforced ?? true;
  }

  /** `deposit_for`: shares are minted pro rata, one for one into an empty book. */
  deposit(who: string, amount: bigint): bigint {
    if (amount <= 0n) throw new Error("ARUNA_ZERO_DEPOSIT");
    const minted = this.totalShares === 0n || this.capital === 0n ? amount : mulDiv(amount, this.totalShares, this.capital);
    if (minted <= 0n) throw new Error("ARUNA_DEPOSIT_TOO_SMALL");
    this.capital += amount;
    this.totalShares += minted;
    this.shares.set(who, (this.shares.get(who) ?? 0n) + minted);
    return minted;
  }

  sharesOf(who: string): bigint {
    return this.shares.get(who) ?? 0n;
  }

  /** `withdraw`: refused until `lockedUntil`, which every purchase pushes out to the coverage's end plus its reporting period. */
  withdraw(who: string, shares: bigint, block: number): { ok: true; amount: bigint } | { ok: false; reason: string } {
    if (this.lockEnforced && block < this.lockedUntil) return { ok: false, reason: "ARUNA_CAPITAL_LOCKED" };
    const held = this.sharesOf(who);
    if (shares <= 0n || shares > held) return { ok: false, reason: "ARUNA_NOT_ENOUGH_SHARES" };
    const amount = mulDiv(shares, this.capital, this.totalShares);
    this.capital -= amount;
    this.totalShares -= shares;
    this.shares.set(who, held - shares);
    return { ok: true, amount };
  }

  /** `cb_buy` after the checks that gate who may buy. `paid` is what the buyer attached. */
  buy(block: number, r: BuyRequest, paid: bigint): BuyResult {
    const other = (detail: string): BuyResult => ({ accepted: false, reason: "other", detail, premium: 0n });
    const p = this.params;
    if (r.limit === 0n || r.limit > U128_MAX / 1_000_000n || r.payoutRatioBps === 0 || r.payoutRatioBps > 10_000) return other("limit must be positive and the payout ratio within 1..=10000 bps");
    if (r.windowBlocks <= p.waitingPeriodBlocks || r.windowBlocks > p.maxWindowBlocks) return other("window must be longer than the waiting period and within the maximum window");
    if (r.dailyCap === 0n) return other("the agent has no daily cap in this token: nothing to cover");
    const q = quote(p, r.class, r.limit, r.payoutRatioBps, r.windowBlocks, r.dailyCap);
    if (!q) return other("class is not insurable");
    if (q.premium === 0n) return other("premium rounds to zero");
    if (paid < q.premium) return other("premium attached is below the quote");

    const capitalAfter = this.capital + q.premium;
    if (this.adequacy && (this.totalLimits + r.limit) * 100n > p.kX100 * capitalAfter) return { accepted: false, reason: "capital_adequacy", detail: "capital adequacy: total limits would exceed k x capital", premium: q.premium };
    const onHash = this.byHash.get(r.hash) ?? 0n;
    const onAuthority = this.byAuthority.get(r.authority) ?? 0n;
    const conc = (p.concentrationBps * capitalAfter) / 10_000n;
    if (this.concentration && (onHash + r.limit > conc || onAuthority + r.limit > conc)) return { accepted: false, reason: "concentration", detail: "concentration limit for this code hash or upgrade authority", premium: q.premium };

    const id = this.coverages.length;
    const c: Coverage = {
      id,
      request: r,
      premium: q.premium,
      startBlock: block,
      waitingPeriodEnds: block + p.waitingPeriodBlocks,
      endBlock: block + r.windowBlocks,
      paidOut: 0n,
      paidThroughBlock: block,
      released: false,
    };
    this.capital = capitalAfter;
    this.totalLimits += r.limit;
    this.lockedUntil = Math.max(this.lockedUntil, c.endBlock + p.claimReportingBlocks);
    this.byHash.set(r.hash, onHash + r.limit);
    this.byAuthority.set(r.authority, onAuthority + r.limit);
    this.coverages.push(c);
    return { accepted: true, id, premium: q.premium };
  }

  /** `release_expired`: an expired coverage's remaining limit leaves the totals. Returns how many were released. */
  releaseExpired(block: number, ids: number[]): number {
    let n = 0;
    for (const id of ids) {
      const c = this.coverages[id];
      if (!c || c.released || block < c.endBlock + this.params.claimReportingBlocks) continue;
      const remaining = sub(c.request.limit, c.paidOut);
      this.totalLimits = sub(this.totalLimits, remaining);
      this.byHash.set(c.request.hash, sub(this.byHash.get(c.request.hash) ?? 0n, remaining));
      this.byAuthority.set(c.request.authority, sub(this.byAuthority.get(c.request.authority) ?? 0n, remaining));
      c.released = true;
      n++;
    }
    return n;
  }

  /**
   * `cb_claim_report` (the change's timing) and `cb_claim_pay` (the payout). The caller has a verified report
   * for a change at `changedAt`; `before*` are the vault's `exposure_before` at that block and at
   * `paidThroughBlock`. All of a claim is paid or none of it: a claim above the book's capital is unpaid.
   */
  claim(id: number, changedAt: number, exposureBeforeChange: bigint, exposureBeforeStart: bigint): ClaimResult {
    const c = this.coverages[id];
    const none = (outcome: string): ClaimResult => ({ outcome, paid: 0n, wanted: 0n });
    if (changedAt < c.waitingPeriodEnds) return none("change inside the waiting period");
    if (changedAt <= c.paidThroughBlock) return none("change already covered by an earlier payout");
    if (changedAt > c.endBlock) return none("change after the coverage ended");

    const exposure = sub(exposureBeforeChange, exposureBeforeStart);
    const room = c.request.limit - c.paidOut;
    const raw = (exposure * BigInt(c.request.payoutRatioBps)) / 10_000n;
    const owed = raw < room ? raw : room;
    if (owed === 0n) return none("no exposure recorded before the change, or limit exhausted");
    if (owed > this.capital) return { outcome: "book capital is insufficient", paid: 0n, wanted: owed };

    this.capital -= owed;
    this.totalLimits = sub(this.totalLimits, owed);
    this.byHash.set(c.request.hash, sub(this.byHash.get(c.request.hash) ?? 0n, owed));
    this.byAuthority.set(c.request.authority, sub(this.byAuthority.get(c.request.authority) ?? 0n, owed));
    c.paidOut += owed;
    c.paidThroughBlock = changedAt;
    return { outcome: "paid", paid: owed, wanted: owed };
  }
}
