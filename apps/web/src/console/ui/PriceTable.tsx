import type { TargetPrice } from "../quote-live";
import { describeQuote, PAYOUT_RATIO_BPS, WINDOW_DAYS, type Cell } from "../data/price";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

function Priced({ c }: { c: Cell }) {
  if (c.kind === "refused") return <span className="text-sm text-dawn-ink" title={c.detail}>{c.text}</span>;
  return (
    <>
      <span className="mono">{c.premium} NEAR</span>
      <span className="block text-xs text-muted">can pay out up to {c.reachable} NEAR</span>
    </>
  );
}

/**
 * The pool's price for each allowed target, on chain and for the draft policy, side by side. The draft is labelled as
 * not signed (R27), and every price says it is testnet and assumed. Nothing here computes a premium.
 */
export function PriceTable({ rows, assumptions }: { rows: TargetPrice[]; assumptions: string | null }) {
  if (rows.length === 0) return <p className="text-sm text-muted">The draft allows no target, so there is nothing to price.</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[15px]">
          <thead>
            <tr>
              <th className={th}>Target</th>
              <th className={th}>Class</th>
              <th className={th}>On chain now</th>
              <th className={th}>Draft: proposed, not yet signed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = describeQuote(r.onChain);
              const dr = describeQuote(r.draft);
              const cls = on.kind === "price" ? on.cls : dr.kind === "price" ? dr.cls : null;
              return (
                <tr key={r.target}>
                  <td className={`${td} mono break-all text-sm`}>{r.target}</td>
                  <td className={`${td} text-sm`}>{cls ?? <span className="text-muted">none on record</span>}</td>
                  <td className={td}>
                    <Priced c={on} />
                  </td>
                  <td className={td}>
                    <Priced c={dr} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 max-w-[80ch] text-sm leading-[1.6] text-muted">
        Testnet, assumed numbers. Premium for a {WINDOW_DAYS} day window with a payout ratio of {PAYOUT_RATIO_BPS / 100}%, quoted by the pool contract.
        {assumptions ? ` ${assumptions}.` : ""} The sum insured is set above what the daily cap can reach, so the price follows the cap.
      </p>
    </>
  );
}
