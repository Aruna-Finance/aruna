import Link from "next/link";
import { amountText, blocksTo, STAGE_TEXT, type CoverageRow } from "../data/coverage-live";
import { block, n0 } from "../fmt";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

function when(row: CoverageRow, head: number): string {
  if (row.stage === "waiting") return `Active from ${block(row.waitingEndsBlock)}, in ${n0(blocksTo(row.waitingEndsBlock, head))} blocks`;
  if (row.stage === "active") return `Ends at ${block(row.endBlock)}, in ${n0(blocksTo(row.endBlock, head))} blocks`;
  return `Ended at ${block(row.endBlock)}`;
}

/** The owner's coverages as the pool holds them. Amounts are the pool's, unchanged. */
export function LiveCoverageTable({ rows, head, agentLabel }: { rows: CoverageRow[]; head: number; agentLabel: (publicKey: string) => string | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[15px]">
        <thead>
          <tr>
            <th className={th}>Agent and target</th>
            <th className={`${th} text-right`}>Limit</th>
            <th className={`${th} text-right`}>Payout ratio</th>
            <th className={`${th} text-right`}>Premium paid</th>
            <th className={th}>State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>
                <span className="block">{agentLabel(r.agent) ?? <span className="mono">{r.agent}</span>}</span>
                <Link href={`/console/targets/detail/?id=${encodeURIComponent(r.target)}`} className="mono text-sm text-muted underline-offset-4 hover:underline">
                  {r.target}
                </Link>
                <span className="mono block text-xs text-muted">coverage #{r.id}</span>
              </td>
              <td className={`${td} mono text-right`}>{amountText(r.token, r.limit)}</td>
              <td className={`${td} mono text-right`}>{r.payoutRatioBps / 100}%</td>
              <td className={`${td} mono text-right`}>{amountText(r.token, r.premiumPaid)}</td>
              <td className={td}>
                <span className="mono text-sm">{STAGE_TEXT[r.stage]}</span>
                <span className="block text-sm text-muted">{when(r, head)}</span>
                {BigInt(r.paidOut) > 0n && <span className="mono block text-sm">Paid out {amountText(r.token, r.paidOut)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
