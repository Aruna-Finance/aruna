import type { ReactNode } from "react";
import type { HistoryState } from "../history";
import { historyNotice } from "./Freshness";

/**
 * Wraps a history list with what it must always say (R10): reading, unavailable (with the last block seen), behind
 * (with the pending transactions), or recorded sample data. When history is unavailable the list is not drawn, so an
 * empty list never stands in for "unavailable" (AE2).
 */
export function HistoryBlock<T>({ h, source, children }: { h: HistoryState<T> | null; source: "live" | "fixture"; children: ReactNode }) {
  if (h === null) return <p className="text-sm text-muted">Reading history.</p>;
  // The recorded sample belongs to the demo vault. For any other vault it is empty, and an empty list would read as "nothing happened".
  if (source === "fixture" && h.state !== "unavailable" && h.items.length === 0) {
    return <p className="border-l-[3px] border-line-2 bg-fog px-4 py-3 text-sm leading-[1.6]">History is not connected in this build, so there is nothing to show for this vault. Balances, agents and actions still work. The hosted indexer URL goes in NEXT_PUBLIC_INDEXER_URL.</p>;
  }
  const notice = historyNotice(h, source);
  return (
    <>
      {notice && <p className="mb-4 border-l-[3px] border-line-2 bg-fog px-4 py-3 text-sm leading-[1.6]">{notice}</p>}
      {h.pending.map((p) => (
        <p key={p.hash} className="mb-2 text-sm text-muted">
          Pending: {p.label} <span className="mono break-all">{p.hash}</span>
        </p>
      ))}
      {h.state !== "unavailable" && children}
    </>
  );
}
