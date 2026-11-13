import type { ClassRecord, DriftReport } from "@aruna/sdk/coverage";
import { describe, expect, it } from "vitest";
import { decide, skipReason } from "../src/decide.js";

const record = (over: Partial<ClassRecord> = {}): ClassRecord => ({ class: "global_by_account", classified_at_block: 100, classifier: "reg.testnet", evidence_hash: "h", frozen: true, ...over });
const report = (state: DriftReport["state"], reportedAt = 200): DriftReport => ({ id: 2, state, reported_at_block: reportedAt, report: {} as DriftReport["report"] });

describe("skipReason: when the keeper leaves a target alone", () => {
  it("acts on a Verified report newer than the class record", () => {
    expect(skipReason(record(), report("verified"))).toBeNull();
  });

  it("acts on a Rejected report newer than the class record", () => {
    expect(skipReason(record(), report("rejected"))).toBeNull();
  });

  it("Covers AE7. leaves a target whose latest report is Pending or Disputed", () => {
    expect(skipReason(record(), report("pending"))).toBe("not_final");
    expect(skipReason(record(), report("disputed"))).toBe("not_final");
  });

  it("Covers AE8. leaves a target whose class record is newer than its report: already handled", () => {
    expect(skipReason(record({ classified_at_block: 300 }), report("verified", 200))).toBe("handled");
  });

  it("treats a record written in the same block as the report as handled", () => {
    expect(skipReason(record({ classified_at_block: 200 }), report("verified", 200))).toBe("handled");
  });

  it("leaves a target with no class record or no report", () => {
    expect(skipReason(null, report("verified"))).toBe("no_record");
    expect(skipReason(record(), null)).toBe("no_report");
  });
});

describe("decide: what to send for a frozen or unfrozen target", () => {
  it("Covers AE5. lifts, then writes, when the new class equals the recorded one", () => {
    expect(decide(record({ class: "global_by_account", frozen: true }), "global_by_account")).toBe("lift_then_write");
  });

  it("lifts, then writes, when the new class is safer", () => {
    expect(decide(record({ class: "global_by_account", frozen: true }), "local_upgradeable")).toBe("lift_then_write");
  });

  it("Covers AE6. writes and holds the freeze when the new class is riskier", () => {
    expect(decide(record({ class: "immutable_verified", frozen: true }), "local_upgradeable")).toBe("hold_and_write");
    expect(decide(record({ class: "global_by_account", frozen: true }), "unknown")).toBe("hold_and_write");
  });

  it("only writes when the target is no longer frozen: the lift landed and the write did not", () => {
    expect(decide(record({ frozen: false }), "global_by_account")).toBe("write");
    expect(decide(record({ class: "immutable_verified", frozen: false }), "unknown")).toBe("write");
  });
});
