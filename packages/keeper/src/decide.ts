import { isNoRiskier, type ClassRecord, type DriftReport } from "@aruna/sdk/coverage";

type RiskClass = ClassRecord["class"];

export type SkipReason = "no_record" | "no_report" | "not_final" | "handled";
export type Action = "write" | "lift_then_write" | "hold_and_write";

export function skipReason(record: ClassRecord | null, report: DriftReport | null): SkipReason | null {
  if (!record) return "no_record";
  if (!report) return "no_report";
  if (report.state !== "verified" && report.state !== "rejected") return "not_final";
  if (record.classified_at_block >= report.reported_at_block) return "handled";
  return null;
}

export function decide(record: ClassRecord, newClass: RiskClass): Action {
  if (!record.frozen) return "write";
  return isNoRiskier(newClass, record.class) ? "lift_then_write" : "hold_and_write";
}
