import { describe, expect, it } from "vitest";
import { createCoverageStore, groupOf } from "./coverage-mock";
import { concentration, withdrawable, worstCasePayout } from "./pool";
import { createPoolStore } from "./pool-mock";

describe("pool concentration (mock)", () => {
  it("groups live coverage by implementation and sorts the largest first", () => {
    const cov = createCoverageStore();
    const groups = concentration(cov.book(), groupOf, 100_000);
    expect(groups[0].limit).toBeGreaterThanOrEqual(groups[groups.length - 1].limit);
    expect(groups.find((g) => g.key === "router-v1")?.targets.sort()).toEqual(["router-2.testnet", "router.testnet"]);
    expect(groups.every((g) => g.cap === 20_000)).toBe(true);
  });

  it("flags a group above its cap", () => {
    const cov = createCoverageStore();
    const over = concentration(cov.book(), groupOf, 10_000).filter((g) => g.over);
    expect(over.length).toBeGreaterThan(0);
  });

  it("locks everything while a challenge window is open", () => {
    expect(withdrawable(100_000, 30_000, true).free).toBe(0);
    expect(withdrawable(100_000, 30_000, false).free).toBe(90_000);
  });

  it("worst case is the top group at the payout ratio", () => {
    expect(worstCasePayout(10_000)).toBe(8_000);
  });
});

describe("pool store (mock)", () => {
  it("a deposit raises the pool capital the coverage checks use", () => {
    const cov = createCoverageStore();
    const pool = createPoolStore(cov);
    pool.deposit("underwriter.testnet", 5_000, ["immutable_verified"]);
    expect(pool.get().capital).toBe(105_000);
    expect(cov.get().poolCapital).toBe(105_000);
  });

  it("refuses a withdrawal larger than the free capital", () => {
    const cov = createCoverageStore();
    const pool = createPoolStore(cov);
    expect(() => pool.withdraw("underwriter.testnet", 99_999, false)).toThrow(/ARUNA_CAPITAL_LOCKED/);
  });

  it("refuses to withdraw capital the account did not deposit", () => {
    const cov = createCoverageStore();
    const pool = createPoolStore(cov);
    expect(() => pool.withdraw("underwriter.testnet", 70_000, false)).toThrow();
  });

  it("refuses a deposit with no class chosen", () => {
    const pool = createPoolStore(createCoverageStore());
    expect(() => pool.deposit("underwriter.testnet", 100, [])).toThrow(/ARUNA_CLASS_REQUIRED/);
  });
});
