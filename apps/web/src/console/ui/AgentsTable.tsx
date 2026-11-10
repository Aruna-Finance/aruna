"use client";

import Link from "next/link";
import { Button } from "@/shared/Button";
import type { AgentRecord } from "../data/vault";
import { n0 } from "../fmt";
import { BudgetBar } from "./BudgetBar";
import { StatusChip } from "./StatusChip";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

/** Agents are looked up at runtime, so the detail page takes the id from the query string. */
export const agentHref = (id: string) => `/console/agents/detail/?id=${encodeURIComponent(id)}`;

export function AgentsTable({
  agents,
  isOperator,
  onFreeze,
  onResume,
}: {
  agents: AgentRecord[];
  isOperator: boolean;
  onFreeze: (a: AgentRecord) => void;
  onResume: (a: AgentRecord) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[15px]">
        <thead>
          <tr>
            <th className={th}>Agent</th>
            <th className={th}>Status</th>
            <th className={th}>Today&apos;s budget</th>
            <th className={`${th} text-right`}>Recorded exposure</th>
            <th className={th}>Coverage</th>
            <th className={th}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id}>
              <td className={td}>
                <Link href={agentHref(a.id)} className="block font-medium underline-offset-4 hover:underline">
                  {a.label}
                </Link>
                <span className="mono text-xs text-muted">{a.publicKey}</span>
              </td>
              <td className={td}>
                <StatusChip a={a} />
              </td>
              <td className={td}>
                <BudgetBar a={a} />
                <span className="mt-1 block whitespace-nowrap text-sm text-muted">
                  {n0(a.spentToday + a.reserved)} of {n0(a.policy.dailyCap)} USDC
                </span>
              </td>
              <td className={`${td} mono whitespace-nowrap text-right`}>
                {n0(Object.values(a.exposure).reduce((x, y) => x + y, 0))} USDC
              </td>
              <td className={`${td} whitespace-nowrap text-sm`}>
                {a.coveredLimit ? `${n0(a.coveredLimit)} USDC` : <span className="text-muted">None</span>}
              </td>
              <td className={`${td} text-right`}>
                {a.status === "Revoked" ? null : a.status === "Active" ? (
                  <Button type="button" variant="outline" className="px-3! py-1.5! text-sm!" onClick={() => onFreeze(a)}>
                    Freeze
                  </Button>
                ) : isOperator ? (
                  <span className="whitespace-nowrap text-sm text-muted">Client resumes</span>
                ) : (
                  <Button type="button" variant="outline" className="px-3! py-1.5! text-sm!" onClick={() => onResume(a)}>
                    Resume
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
