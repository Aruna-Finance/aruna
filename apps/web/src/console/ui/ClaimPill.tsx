import { statusLabel, type ReportStatus } from "../data/claims";

const tone: Record<ReportStatus, string> = {
  challenge_window: "bg-dawn",
  disputed: "bg-dawn-ink",
  paid: "bg-ink",
  rejected: "bg-muted",
};

export function ClaimPill({ status }: { status: ReportStatus }) {
  return (
    <span className={`inline-flex items-center gap-2 text-sm whitespace-nowrap ${status === "disputed" ? "text-dawn-ink" : ""}`}>
      <i className={`inline-block size-2 ${tone[status]}`} aria-hidden />
      {statusLabel[status]}
    </span>
  );
}

/** Reports are created at runtime, so the detail page takes the id from the query string. */
export const reportHref = (id: string) => `/console/claims/detail/?id=${encodeURIComponent(id)}`;
