import Link from "next/link";
import { stageOf, type CoveragePolicy } from "../data/coverage";
import { dateUtc, n0, n2 } from "../fmt";
import { agentHref } from "./AgentsTable";
import { StageBar } from "./StageBar";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

export function CoverageTable({ policies }: { policies: CoveragePolicy[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[15px]">
        <thead>
          <tr>
            <th className={th}>Agent and target</th>
            <th className={`${th} text-right`}>Limit</th>
            <th className={`${th} text-right`}>Payout</th>
            <th className={`${th} text-right`}>Premium</th>
            <th className={th}>Ends</th>
            <th className={th}>State</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((p) => (
            <tr key={p.id}>
              <td className={td}>
                <Link href={agentHref(p.agent)} className="mono block underline-offset-4 hover:underline">
                  {p.agent}
                </Link>
                <span className="mono text-sm text-muted">{p.target}</span>
              </td>
              <td className={`${td} mono text-right`}>{n0(p.limit)}</td>
              <td className={`${td} mono text-right`}>{p.payoutBps / 100}%</td>
              <td className={`${td} mono text-right`}>{n2(p.premiumPaid)}</td>
              <td className={`${td} text-sm whitespace-nowrap`}>{dateUtc(p.expiresAt)}</td>
              <td className={td}>
                <StageBar stage={stageOf(p)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
