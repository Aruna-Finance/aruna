import type { AgentRecord } from "../data/vault";

export function StatusChip({ a }: { a: Pick<AgentRecord, "status" | "autoDisabled"> }) {
  const warn = a.status === "Revoked" || a.autoDisabled;
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${warn ? "text-dawn-ink" : ""}`}>
      <i className={`inline-block size-2 ${a.status === "Active" ? "bg-ink" : warn ? "bg-dawn-ink" : "bg-muted"}`} aria-hidden />
      {a.autoDisabled ? "Stopped by vault" : a.status}
    </span>
  );
}
