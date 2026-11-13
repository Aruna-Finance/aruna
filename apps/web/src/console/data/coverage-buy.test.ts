import { describe, expect, it } from "vitest";
import { BLOCKS_PER_DAY } from "./price";
import { buyRequestOf, formProblem, watchProblem, windowBlocksOf, type BuyForm } from "./coverage-buy";

const form = (o: Partial<BuyForm> = {}): BuyForm => ({ vault: "v.testnet", agentPublicKey: "ed25519:A", target: "drift-target.arunafi.testnet", limitNear: 1, days: 30, ratioPct: 80, ...o });

describe("buy form", () => {
  it("turns NEAR, days and a percentage into the SDK request, as integers", () => {
    expect(buyRequestOf(form({ limitNear: 1.5, days: 7, ratioPct: 80 }))).toEqual({
      vault: "v.testnet", agentPublicKey: "ed25519:A", target: "drift-target.arunafi.testnet", limit: "1500000000000000000000000", payoutRatioBps: 8000, windowBlocks: 7 * BLOCKS_PER_DAY,
    });
    expect(windowBlocksOf(1)).toBe(BLOCKS_PER_DAY);
  });
  it("states a problem for a limit, days or ratio that cannot be sent", () => {
    expect(formProblem(form())).toBeNull();
    expect(formProblem(form({ limitNear: 0 }))).toMatch(/above zero/);
    expect(formProblem(form({ days: 0 }))).toMatch(/whole number of days/);
    expect(formProblem(form({ days: 2.5 }))).toMatch(/whole number of days/);
    expect(formProblem(form({ ratioPct: 0 }))).toMatch(/1 to 100/);
    expect(formProblem(form({ ratioPct: 101 }))).toMatch(/1 to 100/);
  });
});

describe("attestor watch", () => {
  it("offers nothing until the registry has answered", () => {
    expect(watchProblem("t", null)).toBeNull();
  });
  it("refuses a target with no attestor and one whose heartbeat is stale, each with its reason", () => {
    expect(watchProblem("swap.testnet", { attestor: null, fresh: false })).toMatch(/no attestor assigned/);
    expect(watchProblem("drift.testnet", { attestor: "attestor-a.testnet", fresh: false })).toMatch(/attestor-a.testnet.*heartbeat/);
  });
  it("allows a target whose attestor is fresh", () => {
    expect(watchProblem("drift.testnet", { attestor: "attestor-a.testnet", fresh: true })).toBeNull();
  });
});
