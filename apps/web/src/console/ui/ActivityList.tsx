import type { ActivityItem } from "@aruna/indexer/client";
import { block, yoctoToNear } from "../fmt";
import { explorerTxUrl } from "../tx-status";

/** The human name of an event: its event name, else its kind. */
export const kindLabel = (i: ActivityItem) => i.event || i.kind;

const amountText = (i: ActivityItem) => (i.amount ? `${yoctoToNear(i.amount)} ${i.token && i.token !== "near" ? i.token : "NEAR"}` : null);

/**
 * Events of a vault, newest first as given. A refusal shows its reason code, the class the target had when it was
 * refused, and a link to its transaction (R24). Rows are events the vault emitted; nothing here is computed.
 */
export function ActivityList({ items, empty, agentLabel }: { items: ActivityItem[]; empty: string; agentLabel?: (publicKey: string) => string | null }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="grid gap-3 text-sm">
      {items.map((e) => {
        const who = e.agent && agentLabel ? agentLabel(e.agent) : null;
        const refused = e.kind === "refused";
        return (
          <li key={e.seq} className="grid gap-0.5 border-t border-line pt-3">
            <span className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={`mono text-xs ${refused ? "text-dawn-ink" : "text-muted"}`}>{kindLabel(e)}</span>
              <span className="mono text-xs text-muted">{block(e.block)}</span>
            </span>
            <span>
              {who && <span className="font-medium">{who} </span>}
              {e.target && <span className="mono break-all text-muted">to {e.target} </span>}
              {e.reason && <span className="mono text-dawn-ink">{e.reason} </span>}
              {amountText(e) && <span className="text-muted">{amountText(e)}</span>}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-4 text-xs text-muted">
              {refused && <span>Target class at refusal: {e.class ?? "none cached"}</span>}
              <a href={explorerTxUrl(e.tx_hash)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                View transaction
              </a>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
