import { describe, expect, it } from "vitest";
import type { Coverage } from "@aruna/sdk/coverage";
import { claimRows, claimSteps, exposureKey, formulaPayout, reportRow, startable, type ExposureRead, type ReportRow } from "./claims-live";

const cov = (o: Partial<Coverage> = {}): Coverage => ({
  id: 2, owner: "o", vault: "v", agent: "ed25519:A", target: "drift-target.arunafi.testnet", token: "near", limit: "1000000000000000000000000",
  payout_ratio_bps: 8000, premium_paid: "1", class: "global_by_account", code_hash: "H", upgrade_authority: "u", start_block: 10, waiting_period_ends: 20,
  end_block: 1000, policy_version: 1, daily_cap_priced: "1", paid_out: "0", claims: [], claim_in_flight: false, claim_started_at: 0, paid_through_block: 10, ...o,
});
const rep = (o: Partial<ReportRow> = {}): ReportRow => ({ id: 2, target: "drift-target.arunafi.testnet", attestor: "a", channel: "deploy_global_contract", state: "verified", changedAtBlock: 50, observedAtBlock: 51, reportedAtBlock: 52, beforeHash: "x", afterHash: "y", nonce: 1, disputedBy: null, ...o });
const read = (untilChange: string, untilStart: string): ExposureRead => ({ untilChange, untilStart });

describe("claim formula", () => {
  it("is the smaller of exposure in the window times the ratio and what is left of the limit, in integers", () => {
    expect(formulaPayout(100n, 8000, 1000n)).toBe(80n);
    expect(formulaPayout(100n, 8000, 50n)).toBe(50n);
    expect(formulaPayout(1n, 3333, 10n)).toBe(0n);
  });
});

describe("claim steps", () => {
  it("counts from the purchase block, then from the change each paid claim covered", () => {
    const claims = [
      { report_id: 1, paid: "0", outcome: "challenge window still open", block: 60 },
      { report_id: 1, paid: "5", outcome: "paid", block: 90 },
      { report_id: 2, paid: "0", outcome: "x", block: 95 },
    ];
    const steps = claimSteps([cov({ limit: "100", claims })], new Map([[1, rep({ id: 1, changedAtBlock: 50 })], [2, rep({ id: 2, changedAtBlock: 70 })]]));
    expect(steps.map((s) => s.paidThroughBlock)).toEqual([10, 10, 50]);
    expect(steps.map((s) => s.remainingBefore)).toEqual([100n, 100n, 95n]);
  });
});

describe("claim rows", () => {
  const reports = new Map([[2, rep()]]);
  const claims = [
    { report_id: 2, paid: "0", outcome: "challenge window still open", block: 60 },
    { report_id: 2, paid: "80000000000000000000000", outcome: "paid", block: 90 },
  ];
  it("shows the pool's outcome and number with the window's exposure and the formula beside them", () => {
    const rows = claimRows([cov({ claims })], reports, new Map([[exposureKey(2, 1), read("100000000000000000000000", "0")]]));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ outcome: "paid", paid: "80000000000000000000000", exposureInWindow: "100000000000000000000000", byFormula: "80000000000000000000000" });
    expect(rows[0]).toMatchObject({ outcome: "challenge window still open", exposureInWindow: null, byFormula: null });
  });
  it("counts only exposure recorded after the block the pool counted from, as the contract does", () => {
    // 3 recorded before the purchase and 2 more before the change: only the 2 that came after the purchase count.
    const rows = claimRows([cov({ claims: [{ report_id: 2, paid: "0", outcome: "x", block: 60 }] })], reports, new Map([[exposureKey(2, 0), read("5000", "3000")]]));
    expect(rows[0]).toMatchObject({ exposureInWindow: "2000", byFormula: "1600", paidThroughBlock: 10 });
  });
  it("leaves the formula empty, not zero, when the exposure could not be read", () => {
    expect(claimRows([cov({ claims })], reports, new Map())[1]).toMatchObject({ exposureInWindow: null, byFormula: null });
  });
  it("takes what earlier paid claims on the coverage used out of the remaining limit", () => {
    const two = [
      { report_id: 2, paid: "700", outcome: "paid", block: 90 },
      { report_id: 3, paid: "0", outcome: "x", block: 95 },
    ];
    const rows = claimRows([cov({ limit: "1000", claims: two })], new Map([[2, rep()], [3, rep({ id: 3, changedAtBlock: 80 })]]), new Map([[exposureKey(2, 1), read("20000", "10000")]]));
    expect(rows[1]).toMatchObject({ remainingBefore: "300", paidThroughBlock: 50, byFormula: "300" });
  });
});

describe("startable claims", () => {
  const latest = new Map([["drift-target.arunafi.testnet", rep()]]);
  it("offers a verified report on the covered target", () => {
    expect(startable([cov()], latest)).toEqual([{ coverageId: 2, target: "drift-target.arunafi.testnet", reportId: 2 }]);
  });
  it("offers nothing for a report that is not verified, a claim already paid or running, or a released coverage", () => {
    expect(startable([cov()], new Map([["drift-target.arunafi.testnet", rep({ state: "disputed" })]]))).toEqual([]);
    expect(startable([cov({ claims: [{ report_id: 2, paid: "1", outcome: "paid", block: 9 }] })], latest)).toEqual([]);
    expect(startable([cov({ claim_in_flight: true })], latest)).toEqual([]);
    expect(startable([cov({ released: true })], latest)).toEqual([]);
    expect(startable([cov({ target: "other.testnet" })], latest)).toEqual([]);
  });
});

describe("report row", () => {
  it("keeps the registry's fields", () => {
    expect(reportRow({ id: 5, state: "pending", reported_at_block: 9, report: { nonce: 7, target: "t", attestor: "a", channel: "c", changed_at_block: 1, observed_at_block: 2, before_resolved_hash: "b", after_resolved_hash: "z" } })).toMatchObject({ id: 5, state: "pending", changedAtBlock: 1, reportedAtBlock: 9 });
  });
});
