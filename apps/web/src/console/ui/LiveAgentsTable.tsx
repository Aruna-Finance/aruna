"use client";

import Link from "next/link";
import type { AgentView } from "@aruna/sdk";
import { Button } from "@/shared/Button";
import { availability, type ActorRole, type AgentAction } from "../agent-actions";
import { keyInThisBrowser } from "../agent-keys";
import { yoctoToNear, shortKey } from "../fmt";
import { StatusChip } from "./StatusChip";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

/**
 * Agents of a live vault, read from the chain. Each action is shown with its reason when the acting role cannot take
 * it (R21). A key that is not in this browser is marked, and revoke stays available (R23, AE5).
 */
export function LiveAgentsTable({
  agents,
  held,
  actor,
  blockedReason,
  onPause,
  onResume,
  onRevoke,
}: {
  agents: AgentView[];
  held: readonly string[];
  /** Null when the connected wallet may not act: every action is then disabled with `blockedReason`. */
  actor: ActorRole | null;
  blockedReason: string;
  onPause: (a: AgentView) => void;
  onResume: (a: AgentView) => void;
  onRevoke: (a: AgentView) => void;
}) {
  if (agents.length === 0) return <p className="text-muted">This vault has no agents yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[15px] max-sm:min-w-0 max-sm:block max-sm:[&_thead]:hidden max-sm:[&_tbody]:block max-sm:[&_tr]:grid max-sm:[&_tr]:grid-cols-2 max-sm:[&_tr]:gap-x-4 max-sm:[&_tr]:border-b max-sm:[&_tr]:border-line max-sm:[&_tr]:py-3 max-sm:[&_td]:block max-sm:[&_td]:border-0 max-sm:[&_td]:px-0 max-sm:[&_td]:py-1 max-sm:[&_td:first-child]:col-span-2 max-sm:[&_td:last-child]:col-span-2">
        <thead>
          <tr>
            <th className={th}>Agent</th>
            <th className={th}>Status</th>
            <th className={th}>Today&apos;s budget</th>
            <th className={th}>Key</th>
            <th className={th}>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => {
            const near = a.policy.limits?.find((l) => l.token === "near");
            const usage = a.usageByToken?.find((u) => u.token === "near");
            const spent = usage ? BigInt(usage.spentToday) : 0n;
            const reserved = usage ? BigInt(usage.reserved) : 0n;
            const cap = near ? BigInt(near.dailyCap) : 0n;
            const pct = (x: bigint) => (cap > 0n ? `${Math.min(100, Number((x * 10_000n) / cap) / 100)}%` : "0%");
            const can = (action: AgentAction) => (actor ? availability(actor, action, a) : ({ enabled: false, reason: blockedReason } as const));
            const btn = (action: AgentAction, text: string, run: () => void) => {
              const v = can(action);
              return (
                <div key={action} className="flex flex-col items-start gap-1">
                  <Button type="button" variant="outline" className="px-3! py-1.5! text-sm!" disabled={!v.enabled} onClick={run}>
                    {text}
                  </Button>
                  {!v.enabled && v.reason && <span className="max-w-[26ch] text-right text-xs leading-[1.4] text-muted">{v.reason}</span>}
                </div>
              );
            };
            return (
              <tr key={a.publicKey}>
                <td className={td}>
                  <Link href={`/console/agents/detail/?agent=${encodeURIComponent(a.publicKey)}`} className="block font-medium underline-offset-4 hover:underline">
                    {a.label}
                  </Link>
                  <span className="mono text-xs text-muted" title={a.publicKey}>
                    {shortKey(a.publicKey)}
                  </span>
                </td>
                <td className={td}>
                  <StatusChip a={a} />
                </td>
                <td className={td}>
                  {near ? (
                    <>
                      <div role="img" aria-label={`${yoctoToNear(spent.toString())} NEAR spent, ${yoctoToNear(reserved.toString())} reserved, of ${yoctoToNear(near.dailyCap)} NEAR daily cap`} className="flex h-2 w-40 bg-fog">
                        <i className="bg-ink" style={{ width: pct(spent) }} />
                        <i className="bg-dawn" style={{ width: pct(reserved) }} />
                      </div>
                      <span className="mt-1 block whitespace-nowrap text-sm text-muted">
                        {yoctoToNear((spent + reserved).toString())} of {yoctoToNear(near.dailyCap)} NEAR
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted">No NEAR limit</span>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap text-sm`}>
                  {a.status === "Revoked" ? <span className="text-muted">Deleted</span> : keyInThisBrowser(held, a.publicKey) ? "In this browser" : <span className="text-muted">Held elsewhere</span>}
                </td>
                <td className={`${td} text-right`}>
                  <div className="flex flex-row flex-wrap items-start justify-end gap-2 max-sm:justify-start">
                    <Link href={`/console/agents/detail/?agent=${encodeURIComponent(a.publicKey)}`} tabIndex={-1}>
                      <Button type="button" variant="outline" className="px-3! py-1.5! text-sm!">
                        Open
                      </Button>
                    </Link>
                    {a.status !== "Revoked" && (
                      <>
                        {a.status === "Active" ? btn("pause", "Pause", () => onPause(a)) : btn("resume", "Resume", () => onResume(a))}
                        {btn("revoke", "Revoke", () => onRevoke(a))}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
