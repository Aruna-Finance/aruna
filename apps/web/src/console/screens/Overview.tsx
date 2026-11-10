"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { Select } from "@/shared/Select";
import type { RiskClass } from "@/landing/lib/classifier-types";
import { mockTargets } from "../data/mock";
import { vaultStore } from "../data/vault-mock";
import type { AgentRecord, VaultEvent } from "../data/vault";
import { block, n0, n2 } from "../fmt";
import { policyPrice, tighteningOptions, type TighteningOption } from "../pricing";
import { useActions } from "../useActions";
import { AgentsTable } from "../ui/AgentsTable";
import { ClassTag } from "../ui/ClassTag";
import { Panel } from "../ui/Panel";
import { Drawer } from "@/shared/Drawer";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

type DrawerId = "cost" | "control" | "events";
const DRAWERS: Record<DrawerId, string> = {
  cost: "Cost of protection",
  control: "Who controls this vault",
  events: "Recent events",
};

const BAD_EVENTS = new Set(["execution_rejected", "claim_rejected", "target_frozen", "drift_reported", "drift_disputed"]);

function Tile({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="border border-line-2 bg-paper p-5">
      <dt className="label text-xs text-muted">{label}</dt>
      <dd className="mt-2 text-[28px] leading-[1.1]">{children}</dd>
      {sub && <p className="mono mt-1 break-all text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Overview() {
  const { vault, actor, isOperator, ask, run: guarded, freeze, resume } = useActions();
  const [classes, setClasses] = useState<Record<string, RiskClass>>({});
  const [pickId, setPickId] = useState("");
  const [drawer, setDrawer] = useState<DrawerId>("cost");
  const [open, setOpen] = useState(false);
  const show = (id: DrawerId) => {
    setDrawer(id);
    setOpen(true);
  };

  useEffect(() => {
    mockTargets.list().then((rows) => setClasses(Object.fromEntries(rows.map((t) => [t.id, t.classification.class]))));
  }, []);

  const classOf = (t: string) => classes[t];
  const agents = vault.agents;
  const live = agents.filter((a) => a.status !== "Revoked");
  const exposure = agents.reduce((s, a) => s + Object.values(a.exposure).reduce((x, y) => x + y, 0), 0);
  const premiumTotal = live.reduce((s, a) => {
    const p = policyPrice(a.policy, classOf);
    return p.priced ? s + p.total : s;
  }, 0);
  const assigned = live.reduce((s, a) => s + a.policy.dailyCap, 0);

  const target = live.find((a) => a.id === pickId) ?? live[1] ?? live[0];
  const price = target ? policyPrice(target.policy, classOf) : null;
  const options = useMemo(() => (target ? tighteningOptions(target.policy, classOf) : []), [target, classes]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetRows = useMemo(() => {
    const ids = new Set<string>();
    agents.forEach((a) => {
      a.policy.allowedTargets.forEach((t) => ids.add(t));
      Object.keys(a.exposure).forEach((t) => ids.add(t));
    });
    return [...ids].map((id) => ({
      id,
      cls: classes[id],
      exposure: agents.reduce((s, a) => s + (a.exposure[id] ?? 0), 0),
      allowed: agents.filter((a) => a.policy.allowedTargets.includes(id)).length,
    }));
  }, [agents, classes]);

  function tighten(a: AgentRecord, o: TighteningOption) {
    ask({
      title: "Tighten this policy?",
      actions: ["tighten policy"],
      note: `${o.label}. The 30-day premium falls from ${n2(o.before)} to ${n2(o.after)} USDC.`,
      okLabel: "Tighten policy",
      onOk: () => guarded(() => vaultStore.applyPolicy(a.id, o.next, actor), `Policy updated. The premium is now ${n2(o.after)} USDC.`),
    });
  }
  function removeOperator() {
    ask({
      title: "Remove the operator?",
      actions: ["set operator: none"],
      note: "Its agent keys keep working within their policy until you revoke them.",
      okLabel: "Remove operator",
      danger: true,
      onOk: () => guarded(() => vaultStore.setOperator(null), "Operator removed."),
    });
  }

  const stale = vault.version !== vault.latestVersion;

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-[clamp(28px,4vw,44px)]">Agents and what they have at stake</h1>
          <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
            Exposure is what agents sent through the vault. It is not the current value of their positions, which a
            contract cannot read.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(DRAWERS) as DrawerId[]).map((id) => (
            <Button key={id} type="button" variant="outline" onClick={() => show(id)}>
              {DRAWERS[id]}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        {isOperator && (
          <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 leading-[1.6]">
            <strong className="font-medium">You operate this vault for {vault.owner}.</strong> You can add agents within the
            ceiling, pause, revoke and tighten. You cannot loosen a limit, resume an agent, withdraw or change the owner.
          </p>
        )}
        {stale && !isOperator && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-l-[3px] border-dawn bg-dawn-wash px-5 py-4">
            <p className="max-w-[80ch] leading-[1.6]">
              <strong className="font-medium">A newer vault version is available.</strong> This vault runs{" "}
              <span className="mono">{vault.version}</span>, and the current release is{" "}
              <span className="mono">{vault.latestVersion}</span>. Immutable vaults cannot be upgraded in place, so moving
              means a new vault.
            </p>
            <Link href="/console/migrate/">
              <Button type="button" variant="outline" tabIndex={-1}>
                Review migration
              </Button>
            </Link>
          </div>
        )}

        <dl className="grid gap-px border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4 [&>div]:border-0">
          <Tile label="Vault" sub={vault.vault}>
            <span className="mono text-lg">{vault.version}</span>
          </Tile>
          <Tile label="Agents">
            {agents.filter((a) => a.status === "Active").length}
            <small className="ml-1 text-base text-muted">of {agents.length} active</small>
          </Tile>
          <Tile label="Recorded exposure">
            {n0(exposure)}
            <small className="ml-1 text-base text-muted">USDC</small>
          </Tile>
          <Tile label="Premium for current policies">
            {n2(premiumTotal)}
            <small className="ml-1 text-base text-muted">USDC / 30 days</small>
          </Tile>
        </dl>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
            <Panel title="Agents">
              <AgentsTable agents={agents} isOperator={isOperator} onFreeze={freeze} onResume={resume} />
            </Panel>

            <Panel
              title="Contracts your agents touch"
              aside={
                <Link href="/console/targets/" className="text-sm underline underline-offset-4">
                  See all targets
                </Link>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-[15px]">
                  <thead>
                    <tr>
                      <th className={th}>Target</th>
                      <th className={th}>Class</th>
                      <th className={`${th} text-right`}>Your exposure</th>
                      <th className={`${th} text-right`}>Agents allowed</th>
                      <th className={th}>Coverable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetRows.map((r) => (
                      <tr key={r.id}>
                        <td className={`${td} mono`}>{r.id}</td>
                        <td className={td}>{r.cls ? <ClassTag c={r.cls} /> : <span className="text-muted">Loading</span>}</td>
                        <td className={`${td} mono whitespace-nowrap text-right`}>{n0(r.exposure)} USDC</td>
                        <td className={`${td} mono text-right`}>{r.allowed}</td>
                        <td className={`${td} text-sm`}>{r.cls === "unknown" ? <span className="text-dawn-ink">No</span> : "Yes"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

        </div>
      </div>


      <Drawer open={open} onClose={() => setOpen(false)} title={DRAWERS[drawer]}>
        {drawer === "cost" && (
          <div>
              <p className="-mt-2 mb-4 text-sm text-muted">Premium inputs include P(event), an underwriting assumption.</p>
              {target ? (
                <>
                  <Select
                    label="Agent"
                    value={target.id}
                    onValueChange={setPickId}
                    options={live.map((a) => ({ value: a.id, label: a.label }))}
                    className="w-full"
                  />
                  {price?.priced ? (
                    <>
                      <p className="mt-5 text-[28px] leading-[1.1]">
                        {n2(price.total)}
                        <small className="ml-1 text-base text-muted">USDC per 30 days</small>
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {price.pctOfLimit.toFixed(1)}% of the {n0(price.limit)} USDC this policy allows. Priced at its
                        riskiest class, {price.worst}.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-5 text-[28px] leading-[1.1]">Not priced</p>
                      <p className="mt-1 text-sm text-muted">{price && !price.priced ? price.reason : ""}</p>
                    </>
                  )}
                  <p className="label mt-6 text-xs text-muted">What tightening saves</p>
                  {options.length ? (
                    <ul className="mt-2">
                      {options.map((o) => (
                        <li key={o.id} className="flex items-center justify-between gap-3 border-t border-line py-3">
                          <div className="min-w-0 text-sm">
                            {o.label}
                            <br />
                            <span className="mono text-dawn-ink">-{n2(o.saves)} USDC</span>{" "}
                            <span className="text-muted">to {n2(o.after)}</span>
                          </div>
                          <Button type="button" variant="outline" className="px-3! py-1.5! text-sm!" onClick={() => tighten(target, o)}>
                            Apply
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted">This policy is already at its tightest useful setting.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">No agent to price.</p>
              )}
            </div>
        )}
        {drawer === "control" && (
          <div>
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="text-muted">Owner, the client</dt>
                  <dd className="mono">{vault.owner}</dd>
                </div>
                <div>
                  <dt className="text-muted">Operator</dt>
                  <dd className="mono">{vault.operator ?? "None"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Ceiling per transaction</dt>
                  <dd className="mono">{n0(vault.ceiling.maxPerTx)} USDC</dd>
                </div>
                <div>
                  <dt className="text-muted">Ceiling per day, all agents</dt>
                  <dd className="mono">
                    {n0(vault.ceiling.dailyTotal)} USDC, {n0(assigned)} assigned
                  </dd>
                </div>
              </dl>
              {!isOperator && vault.operator && (
                <Button type="button" variant="outline" className="mt-5 px-3! py-1.5! text-sm!" onClick={removeOperator}>
                  Remove the operator
                </Button>
              )}
              {!isOperator && !vault.operator && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-5 px-3! py-1.5! text-sm!"
                  onClick={() => guarded(() => vaultStore.setOperator("opsdesk.testnet"), "Operator restored.")}
                >
                  Restore the operator
                </Button>
              )}
            </div>
        )}
        {drawer === "events" && (
          <div>
              <ul className="grid gap-3 text-sm">
                {vault.events.slice(0, 5).map((e: VaultEvent) => (
                  <li key={e.id} className="grid gap-0.5">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={`mono text-xs ${BAD_EVENTS.has(e.type) ? "text-dawn-ink" : "text-muted"}`}>{e.type}</span>
                      <span className="mono text-xs text-muted">{block(e.block)}</span>
                    </span>
                    <span>
                      {e.agent && <span className="mono">{e.agent} </span>}
                      {e.target && <span className="mono text-muted">to {e.target} </span>}
                      {e.code && <span className="mono text-dawn-ink">ARUNA_{e.code} </span>}
                      {e.detail && <span className="text-muted">{e.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
        )}
      </Drawer>

    </article>
  );
}
