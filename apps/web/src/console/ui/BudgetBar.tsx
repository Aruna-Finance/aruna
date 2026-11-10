import type { AgentRecord } from "../data/vault";
import { n0 } from "../fmt";

export function BudgetBar({ a, wide }: { a: AgentRecord; wide?: boolean }) {
  const cap = a.policy.dailyCap;
  const w = (x: number) => `${Math.min(100, (x / cap) * 100)}%`;
  return (
    <div
      role="img"
      aria-label={`${n0(a.spentToday)} spent, ${n0(a.reserved)} reserved, of ${n0(cap)} USDC daily cap`}
      className={`flex h-2 bg-fog ${wide ? "w-full" : "w-40"}`}
    >
      <i className="bg-ink" style={{ width: w(a.spentToday) }} />
      <i className="bg-dawn" style={{ width: w(a.reserved) }} />
    </div>
  );
}

export function BudgetLegend({ a }: { a: AgentRecord }) {
  const left = Math.max(0, a.policy.dailyCap - a.spentToday - a.reserved);
  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
      <span>
        <i className="mr-2 inline-block size-2 bg-ink" aria-hidden />
        Spent {n0(a.spentToday)}
      </span>
      <span>
        <i className="mr-2 inline-block size-2 bg-dawn" aria-hidden />
        Reserved {n0(a.reserved)}
      </span>
      <span>
        <i className="mr-2 inline-block size-2 bg-fog" aria-hidden />
        Left {n0(left)} of {n0(a.policy.dailyCap)} USDC
      </span>
    </div>
  );
}
