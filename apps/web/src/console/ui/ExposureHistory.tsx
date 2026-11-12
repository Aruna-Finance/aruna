import type { ExposureRow } from "@aruna/indexer/client";
import { block, yoctoToNear } from "../fmt";
import { explorerTxUrl } from "../tx-status";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";
const unit = (token: string) => (token === "near" ? "NEAR" : token);

/**
 * What agents sent to each target and settled, row by row (R25). It is exposure: what left the vault, not the value
 * of a position, which a contract cannot read. The class shown is the one recorded with the row, which can differ
 * from the target's class today.
 */
export function ExposureHistory({ rows, empty }: { rows: ExposureRow[]; empty: string }) {
  return (
    <>
      <p className="mb-4 max-w-[70ch] text-sm text-muted">Exposure is what was sent through the vault. It is not the current value of any position.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[15px]">
            <thead>
              <tr>
                <th className={th}>Block</th>
                <th className={th}>Target</th>
                <th className={`${th} text-right`}>Sent</th>
                <th className={`${th} text-right`}>Total to target</th>
                <th className={th}>Class when recorded</th>
                <th className={th}>
                  <span className="sr-only">Transaction</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seq}>
                  <td className={`${td} mono text-sm`}>{block(r.block)}</td>
                  <td className={`${td} mono break-all text-sm`}>{r.target}</td>
                  <td className={`${td} mono whitespace-nowrap text-right`}>
                    {yoctoToNear(r.amount)} {unit(r.token)}
                  </td>
                  <td className={`${td} mono whitespace-nowrap text-right`}>
                    {yoctoToNear(r.total)} {unit(r.token)}
                  </td>
                  <td className={`${td} text-sm`}>{r.class ?? "none cached"}</td>
                  <td className={`${td} text-sm`}>
                    <a href={explorerTxUrl(r.tx_hash)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                      View transaction
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
