// The keeper's rules for one target, with no I/O (plan KTD3). The chain is the keeper's only memory: a target is
// unhandled while its class record is older than its latest report, so a run that stops half way is finished by the
// next one and a target already handled sends nothing.
import { isNoRiskier, type ClassRecord, type DriftReport } from "@aruna/sdk/coverage";

type RiskClass = ClassRecord["class"];

export type SkipReason = "no_record" | "no_report" | "not_final" | "handled";
export type Action = "write" | "lift_then_write" | "hold_and_write";

/**
 * Why the keeper leaves this target alone, or null when it should act: its latest report is final (Verified or
 * Rejected, never Pending or Disputed) and its class record predates that report.
 */
export function skipReason(record: ClassRecord | null, report: DriftReport | null): SkipReason | null {
  if (!record) return "no_record";
  if (!report) return "no_report";
  if (report.state !== "verified" && report.state !== "rejected") return "not_final";
  if (record.classified_at_block >= report.reported_at_block) return "handled";
  return null;
}

/**
 * What to send once the target's current code is classified as `newClass`. While it is frozen, the freeze is lifted
 * only when that class is no riskier than the recorded one; a riskier class is written and the freeze stays for a
 * person to decide. Lifting comes before writing so a crash between the two leaves the record older than the report,
 * and the next run finishes the write.
 */
export function decide(record: ClassRecord, newClass: RiskClass): Action {
  if (!record.frozen) return "write";
  return isNoRiskier(newClass, record.class) ? "lift_then_write" : "hold_and_write";
}
