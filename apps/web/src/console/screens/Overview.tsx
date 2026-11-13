"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createTestnetReads } from "../chain-reads";
import { overviewOf } from "../data/overview";
import { yoctoToNear } from "../fmt";
import { useLiveVault } from "../useLiveVault";
import { newestFirst, useVaultHistory } from "../useVaultHistory";
import { useWallet } from "../WalletContext";
import { relationOf, RELATION_TEXT } from "../walletRole";
import { ActivityList } from "../ui/ActivityList";
import { ExposureHistory } from "../ui/ExposureHistory";
import { HistoryBlock } from "../ui/HistoryBlock";
import { NoVault } from "../ui/NoVault";
import { Panel } from "../ui/Panel";
import { VaultSwitch } from "../ui/VaultSwitch";
import { StatusChip } from "../ui/StatusChip";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

function Tile({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="border border-line-2 bg-paper p-5">
      <dt className="label text-xs text-muted">{label}</dt>
      <dd className="mt-2 text-[28px] leading-[1.1]">{children}</dd>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  );
}

export function Overview() {
  const live = useLiveVault();
  if (live.status !== "ok") return <NoVault live={live} title="Agents and what they have at stake" />;
  return <LiveOverview live={live} />;
}

function LiveOverview({ live }: { live: Extract<ReturnType<typeof useLiveVault>, { status: "ok" }> }) {
  const { vault, view } = live;
  const { accountId } = useWallet();
  const relation = relationOf(accountId, view);
  const o = useMemo(() => overviewOf(view), [view]);
  const reads = useMemo(() => createTestnetReads(), []);
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    let alive = true;
    reads.balance(vault).then((v) => alive && setBalance(v)).catch(() => alive && setBalance(null));
    return () => {
      alive = false;
    };
  }, [reads, vault, view]);
  const { history, activity, exposure } = useVaultHistory(vault, { refreshKey: view });
  const labelOf = (pk: string) => view.agents.find((a) => a.publicKey === pk)?.label ?? null;
  const agentsHref = `/console/agents/?vault=${encodeURIComponent(vault)}`;

  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Agents and what they have at stake</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Exposure is what agents sent through the vault. It is not the current value of their positions, which a contract cannot read.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <p className="border-l-[3px] border-line-2 bg-fog px-5 py-4 text-[15px] leading-[1.6]">
          {relation ? RELATION_TEXT[relation] : "Connect a wallet to act on this vault. You can read it without one."}
        </p>

        <dl className="grid gap-px border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4 [&>div]:border-0">
          <Tile label="Vault" sub={<VaultSwitch vault={vault} />}>
            <span className="mono text-lg">{view.fullAccessKeys === 0 ? "No full-access key" : `${view.fullAccessKeys} full-access`}</span>
          </Tile>
          <Tile label="Agents">
            {o.agentsActive}
            <small className="ml-1 text-base text-muted">of {o.agentsTotal} active</small>
          </Tile>
          <Tile label="Vault balance">
            {balance === null ? <span className="text-base text-muted">unknown</span> : yoctoToNear(balance.toString())}
            <small className="ml-1 text-base text-muted">NEAR</small>
          </Tile>
          <Tile label="Recorded exposure">
            {yoctoToNear(o.exposureNear.toString())}
            <small className="ml-1 text-base text-muted">NEAR</small>
          </Tile>
        </dl>

        <Panel
          title="Agents"
          aside={
            <Link href={agentsHref} className="text-sm underline underline-offset-4">
              Manage agents
            </Link>
          }
        >
          {view.agents.length === 0 ? (
            <p className="text-sm text-muted">This vault has no agents yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className={th}>Agent</th>
                    <th className={th}>Status</th>
                    <th className={`${th} text-right`}>Today</th>
                  </tr>
                </thead>
                <tbody>
                  {view.agents.map((a) => {
                    const near = a.policy.limits?.find((l) => l.token === "near");
                    const u = a.usageByToken?.find((x) => x.token === "near");
                    const used = u ? BigInt(u.spentToday) + BigInt(u.reserved) : 0n;
                    return (
                      <tr key={a.publicKey}>
                        <td className={td}>
                          <Link href={`/console/agents/detail?agent=${encodeURIComponent(a.publicKey)}&vault=${encodeURIComponent(vault)}`} className="font-medium underline-offset-4 hover:underline">
                            {a.label}
                          </Link>
                        </td>
                        <td className={td}>
                          <StatusChip a={a} />
                        </td>
                        <td className={`${td} mono whitespace-nowrap text-right text-sm`}>
                          {near ? `${yoctoToNear(used.toString())} of ${yoctoToNear(near.dailyCap)} NEAR` : "No NEAR limit"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Contracts your agents touch">
          {o.targets.length === 0 ? (
            <p className="text-sm text-muted">No agent is allowed to call anything yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className={th}>Target</th>
                    <th className={th}>Class when last sent to</th>
                    <th className={`${th} text-right`}>Your exposure</th>
                    <th className={`${th} text-right`}>Agents allowed</th>
                  </tr>
                </thead>
                <tbody>
                  {o.targets.map((r) => (
                    <tr key={r.target}>
                      <td className={`${td} mono break-all text-sm`}>{r.target}</td>
                      <td className={`${td} text-sm`}>{r.classAtRecord ?? <span className="text-muted">Nothing sent yet</span>}</td>
                      <td className={`${td} mono whitespace-nowrap text-right`}>{yoctoToNear(r.exposure.toString())} NEAR</td>
                      <td className={`${td} mono text-right`}>{r.allowedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Exposure history">
          <HistoryBlock h={exposure} source={history.source}>
            <ExposureHistory rows={newestFirst(exposure)} empty="Nothing that settled has been recorded yet." />
          </HistoryBlock>
        </Panel>

        <Panel title="Recent activity" aside={<span className="text-sm text-muted">Refreshes every 15 seconds</span>}>
          <HistoryBlock h={activity} source={history.source}>
            <ActivityList items={newestFirst(activity).slice(0, 30)} empty="No events yet." agentLabel={labelOf} />
          </HistoryBlock>
        </Panel>
      </div>
    </article>
  );
}
