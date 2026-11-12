import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Book, CONTRACT_PARAMS, quote, type RiskClass } from "../src/rules.js";

const repo = (p: string) => new URL(`../../../${p}`, import.meta.url);
const golden = JSON.parse(readFileSync(repo("fixtures/golden/pool-rules.json"), "utf8"));
const NOW = 1_000;
const NEAR = 10n ** 24n;
const B = (s: string) => BigInt(s);

describe("the model's pool rules equal the pool contract's (golden vectors from the real pool)", () => {
  it("the parameters in the file, from the contract's params.rs, are the model's", () => {
    const p = golden.params;
    expect(p.blocks_per_day).toBe(CONTRACT_PARAMS.blocksPerDay);
    expect(B(p.k_x100)).toBe(CONTRACT_PARAMS.kX100);
    expect(B(p.concentration_bps)).toBe(CONTRACT_PARAMS.concentrationBps);
    expect(BigInt(p.risk_margin_bps)).toBe(CONTRACT_PARAMS.riskMarginBps);
    expect(BigInt(p.capital_cost_bps_30d)).toBe(CONTRACT_PARAMS.capitalCostBps30d);
    expect(p.p_event_bps_30d).toEqual(CONTRACT_PARAMS.pEventBps30d);
    expect(p.waiting_period_blocks).toBe(CONTRACT_PARAMS.waitingPeriodBlocks);
    expect(p.claim_reporting_blocks).toBe(CONTRACT_PARAMS.claimReportingBlocks);
  });

  it("the model's constants are the numbers written in contracts/common/src/params.rs", () => {
    const src = readFileSync(repo("contracts/common/src/params.rs"), "utf8");
    const num = (name: string) => {
      const m = src.match(new RegExp(`pub const ${name}: [a-z0-9]+ = ([0-9_]+);`));
      if (!m) throw new Error(`${name} not found in params.rs`);
      return BigInt(m[1].replace(/_/g, ""));
    };
    expect(num("BLOCKS_PER_DAY")).toBe(BigInt(CONTRACT_PARAMS.blocksPerDay));
    expect(num("K_X100")).toBe(CONTRACT_PARAMS.kX100);
    expect(num("CONCENTRATION_BPS")).toBe(CONTRACT_PARAMS.concentrationBps);
    expect(num("RISK_MARGIN_BPS")).toBe(CONTRACT_PARAMS.riskMarginBps);
    expect(num("CAPITAL_COST_BPS_30D")).toBe(CONTRACT_PARAMS.capitalCostBps30d);
    expect(num("WAITING_PERIOD_BLOCKS")).toBe(BigInt(CONTRACT_PARAMS.waitingPeriodBlocks));
    expect(num("CLAIM_REPORTING_BLOCKS")).toBe(BigInt(CONTRACT_PARAMS.claimReportingBlocks));
    const pEvent = (cls: string) => {
      const m = src.match(new RegExp(`RiskClass::${cls} => Some\\(([0-9_]+)\\)`));
      if (!m) throw new Error(`P(event) for ${cls} not found in params.rs`);
      return Number(m[1].replace(/_/g, ""));
    };
    expect({ immutable_verified: pEvent("ImmutableVerified"), local_upgradeable: pEvent("LocalUpgradeable"), global_by_account: pEvent("GlobalByAccount") }).toEqual(CONTRACT_PARAMS.pEventBps30d);
  });

  it(`all ${golden.quotes.length} quotes (four classes, four windows, five shapes)`, () => {
    for (const q of golden.quotes) {
      const got = quote(CONTRACT_PARAMS, q.class as RiskClass, B(q.limit), q.payout_ratio_bps, q.window_blocks, B(q.daily_cap));
      const label = JSON.stringify(q);
      if (!q.insurable) {
        expect(got, label).toBeNull();
        continue;
      }
      expect(got, label).not.toBeNull();
      expect({ days: got!.days, reachable: got!.reachable.toString(), expected_loss: got!.expectedLoss.toString(), premium: got!.premium.toString() }, label).toEqual({ days: q.days, reachable: q.reachable, expected_loss: q.expected_loss, premium: q.premium });
    }
  });

  for (const run of golden.purchase_runs as { name: string; capital: string; steps: Record<string, any>[] }[]) it(`purchases, releases, adequacy and concentration: ${run.name}`, () => {
    const book = new Book();
    book.deposit("underwriter", B(run.capital));
    let i = 0;
    for (const s of run.steps) {
      i++;
      const at = `step ${i} (${s.op})`;
      if (s.op === "release") {
        expect(book.releaseExpired(s.at_block, s.ids), at).toBe(s.released);
      } else {
        const req = { class: s.class as RiskClass, hash: s.hash, authority: s.authority, limit: B(s.limit), dailyCap: B(s.daily_cap), payoutRatioBps: s.payout_ratio_bps, windowBlocks: s.window_blocks };
        const q = quote(CONTRACT_PARAMS, req.class, req.limit, req.payoutRatioBps, req.windowBlocks, req.dailyCap)!;
        expect(q.premium.toString(), `${at} premium`).toBe(s.premium);
        const r = book.buy(s.at_block, req, q.premium);
        expect(r.accepted, `${at} accepted`).toBe(s.accepted);
        if (!r.accepted) expect(r.reason, `${at} reason`).toBe(s.reason);
        expect(book.lockedUntil, `${at} locked_until`).toBe(s.locked_until);
      }
      expect(book.totalLimits.toString(), `${at} total limits`).toBe(s.total_limits_after);
      expect(book.capital.toString(), `${at} capital`).toBe(s.capital_after);
    }
  });

  for (const run of golden.payout_runs as { name: string; capital: string; limit: string; payout_ratio_bps: number; premium: string; claims: Record<string, string>[] }[]) it(`payouts: ${run.name}`, () => {
    const book = new Book();
    book.deposit("underwriter", B(run.capital));
    const req = { class: "local_upgradeable" as const, hash: "H1", authority: "a1.testnet", limit: B(run.limit), dailyCap: NEAR, payoutRatioBps: run.payout_ratio_bps, windowBlocks: CONTRACT_PARAMS.blocksPerDay };
    const q = quote(CONTRACT_PARAMS, req.class, req.limit, req.payoutRatioBps, req.windowBlocks, req.dailyCap)!;
    expect(q.premium.toString()).toBe(run.premium);
    expect(book.buy(NOW, req, q.premium).accepted).toBe(true);
    run.claims.forEach((c, i) => {
      const r = book.claim(0, NOW + 200 + 100 * i, B(c.exposure_before_change), B(c.exposure_before_start));
      expect(r.paid.toString(), `claim ${i} paid`).toBe(c.owed);
      expect(r.outcome, `claim ${i} outcome`).toBe(c.outcome);
      expect(book.capital.toString(), `claim ${i} capital`).toBe(c.capital_after);
      expect(book.totalLimits.toString(), `claim ${i} total limits`).toBe(c.total_limits_after);
    });
  });
});

describe("rules the contract states in words", () => {
  it("a deposit that rounds to no shares is refused, and a withdrawal is locked until the reporting period ends", () => {
    const b = new Book();
    b.deposit("u", 10n * NEAR);
    expect(() => b.deposit("v", 0n)).toThrow(/ZERO_DEPOSIT/);
    const req = { class: "local_upgradeable" as const, hash: "H", authority: "a", limit: 5n * NEAR, dailyCap: NEAR, payoutRatioBps: 8_000, windowBlocks: 10 * CONTRACT_PARAMS.blocksPerDay };
    const r = b.buy(NOW, req, quote(CONTRACT_PARAMS, req.class, req.limit, req.payoutRatioBps, req.windowBlocks, req.dailyCap)!.premium);
    expect(r.accepted).toBe(true);
    const end = NOW + req.windowBlocks + CONTRACT_PARAMS.claimReportingBlocks;
    expect(b.withdraw("u", b.sharesOf("u") / 2n, end - 1)).toEqual({ ok: false, reason: "ARUNA_CAPITAL_LOCKED" });
    const w = b.withdraw("u", b.sharesOf("u") / 2n, end);
    expect(w.ok).toBe(true);
  });

  it("the lock can be switched off, for a labelled counterfactual only", () => {
    const b = new Book(CONTRACT_PARAMS, { lockEnforced: false });
    b.deposit("u", 10n * NEAR);
    const req = { class: "local_upgradeable" as const, hash: "H", authority: "a", limit: 5n * NEAR, dailyCap: NEAR, payoutRatioBps: 8_000, windowBlocks: 10 * CONTRACT_PARAMS.blocksPerDay };
    b.buy(NOW, req, 10n * NEAR);
    expect(b.withdraw("u", b.sharesOf("u") / 2n, NOW + 1).ok).toBe(true);
  });
});
