"use client";

import { PageHeader } from "../ui/PageHeader";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AgentView } from "@aruna/sdk";
import { Button } from "@/shared/Button";
import { ACCESS_KEY_ROWS, REFUSALS } from "@/landing/lib/facts";
import { curlFor } from "@/landing/lib/verify-commands";
import { availability, isTighter, policyProblem, type ActorRole } from "../agent-actions";
import { createTestnetReads } from "../chain-reads";
import { draftFromPolicy, draftToPolicy } from "../data/agent-draft";
import { classifiedTargets, readFactory, type TargetOption } from "../data/factory";
import { block, yoctoToNear } from "../fmt";
import { defaultHistory, type HistoryState } from "../history";
import { actorFor, noActorReason } from "../live-vault";
import { useBalance } from "../useBalance";
import { useLiveActions } from "../useLiveActions";
import { useLiveVault, type LiveVault } from "../useLiveVault";
import { useRole } from "../RoleContext";
import { useWallet } from "../WalletContext";
import { relationOf } from "../walletRole";
import { ClassTag } from "../ui/ClassTag";
import { CopyBlock } from "../ui/CopyBlock";
import { NumberField } from "../ui/Field";
import { ActivityList } from "../ui/ActivityList";
import { ExposureHistory } from "../ui/ExposureHistory";
import { HistoryBlock } from "../ui/HistoryBlock";
import { newestFirst, useVaultHistory } from "../useVaultHistory";
import { NoVault } from "../ui/NoVault";
import { PricePanel } from "../ui/PricePanel";
import { Panel } from "../ui/Panel";
import { ClassPicker } from "../ui/PolicyFields";
import { StatusChip } from "../ui/StatusChip";
import { Tabs } from "../ui/Tabs";
import { TokenIcon } from "../ui/Token";

type Tab = "overview" | "policy" | "activity" | "funding" | "access";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "policy", label: "Limits" },
  { id: "activity", label: "Activity" },
  { id: "funding", label: "Funds and allowance" },
  { id: "access", label: "Key and proof" },
];

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

/** Counted refusals: the reasons that feed the auto-disable score (docs/CONTRACTS.md). */
const COUNTED = new Set(REFUSALS.filter((r) => r.counts).map((r) => r.reason));

function NotFound({ id }: { id: string | null }) {
  return (
    <article>
      <PageHeader title="Agent not found">
        {id ? <>No agent with key <span className="mono break-all">{id}</span> exists on this vault.</> : "No agent was named in the link."}{" "}
        <Link href="/console/agents/" className="underline underline-offset-4">
          Back to the agent list
        </Link>
        .
      </PageHeader>
    </article>
  );
}

export function AgentDetail() {
  const id = useSearchParams().get("agent");
  const live = useLiveVault();
  if (live.status !== "ok") return <NoVault live={live} title="Agent" />;
  const agent = live.view.agents.find((a) => a.publicKey === id);
  return agent ? <Detail key={agent.publicKey} live={live} agent={agent} /> : <NotFound id={id} />;
}

function useRoleOn(live: Extract<LiveVault, { status: "ok" }>) {
  const { accountId } = useWallet();
  const { role } = useRole();
  const relation = relationOf(accountId, live.view);
  return { relation, actor: actorFor(relation, role) };
}

function Detail({ live, agent: a }: { live: Extract<LiveVault, { status: "ok" }>; agent: AgentView }) {
  const [tab, setTab] = useState<Tab>("overview");
  const acts = useLiveActions(live.vault, live.refresh);
  const { relation, actor } = useRoleOn(live);
  const can = (action: Parameters<typeof availability>[1]) => (actor ? availability(actor, action, a) : ({ enabled: false, reason: noActorReason(relation) } as const));
  const history = useMemo(() => defaultHistory(), []);
  const [counted, setCounted] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    history.activity(live.vault, { agent: a.publicKey }).then((h) => alive && setCounted(h.state === "unavailable" ? null : h.items.filter((i) => i.reason !== null && COUNTED.has(i.reason)).length));
    return () => {
      alive = false;
    };
  }, [history, live.vault, a.publicKey, live.view]);

  const pause = can("pause");
  const resume = can("resume");
  const revoke = can("revoke");

  return (
    <article>
      <PageHeader
        title={a.label}
        lead={
          <p className="text-muted">
            <Link href="/console/agents/" className="underline underline-offset-4">
              Agents
            </Link>{" "}
            / <span className="mono break-all">{a.publicKey}</span>
          </p>
        }
        actions={
          <>
            {a.status === "Active" && <ActionButton v={pause} variant="dark" onClick={() => acts.pause(a.publicKey, a.label)}>Freeze agent</ActionButton>}
            {a.status === "Paused" && <ActionButton v={resume} onClick={() => acts.resume(a.publicKey, a.label)}>Resume agent</ActionButton>}
            {a.status !== "Revoked" && <ActionButton v={revoke} variant="dark" onClick={() => acts.revoke(a.publicKey, a.label)}>Revoke agent</ActionButton>}
          </>
        }
      >
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <StatusChip a={a} />
          <span className="text-sm text-muted">Counted refusals {counted === null ? "unavailable" : counted}</span>
        </span>
      </PageHeader>

      <div className="mt-8">
        <Tabs tabs={TABS} value={tab} onChange={setTab}>
          {tab === "overview" && <OverviewTab live={live} a={a} />}
          {tab === "policy" && <PolicyTab live={live} a={a} actor={actor} reason={noActorReason(relation)} />}
          {tab === "activity" && <ActivityTab live={live} a={a} />}
          {tab === "funding" && <FundingTab live={live} a={a} />}
          {tab === "access" && <AccessTab live={live} a={a} />}
        </Tabs>
      </div>
    </article>
  );
}

function ActionButton({ v, variant, onClick, children }: { v: ReturnType<typeof availability>; variant?: "dark"; onClick: () => void; children: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant={variant} disabled={!v.enabled} onClick={onClick}>
        {children}
      </Button>
      {!v.enabled && <span className="max-w-[28ch] text-right text-xs leading-[1.4] text-muted">{v.reason}</span>}
    </div>
  );
}

function OverviewTab({ live, a }: { live: Extract<LiveVault, { status: "ok" }>; a: AgentView }) {
  const balance = useBalance(live.vault, live.view);
  const near = a.policy.limits?.find((l) => l.token === "near");
  const usage = a.usageByToken?.find((u) => u.token === "near");
  const spent = usage ? BigInt(usage.spentToday) : 0n;
  const reserved = usage ? BigInt(usage.reserved) : 0n;
  const cap = near ? BigInt(near.dailyCap) : 0n;
  const left = cap > spent + reserved ? cap - spent - reserved : 0n;
  const pct = (x: bigint) => (cap > 0n ? `${Math.min(100, Number((x * 10_000n) / cap) / 100)}%` : "0%");
  const rows = live.view.exposureByToken ?? live.view.exposure ?? [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Panel title="Today's budget" aside={<span className="mono text-sm text-muted">Vault balance {balance === null ? "unknown" : `${yoctoToNear(balance.toString())} NEAR`}</span>}>
        {near ? (
          <>
            <div role="img" aria-label={`${yoctoToNear(spent.toString())} NEAR spent, ${yoctoToNear(reserved.toString())} reserved, of ${yoctoToNear(near.dailyCap)} NEAR daily cap`} className="flex h-2 w-full bg-fog">
              <i className="bg-ink" style={{ width: pct(spent) }} />
              <i className="bg-dawn" style={{ width: pct(reserved) }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
              <span>
                <i className="mr-2 inline-block size-2 bg-ink" aria-hidden />
                Spent {yoctoToNear(spent.toString())}
              </span>
              <span>
                <i className="mr-2 inline-block size-2 bg-dawn" aria-hidden />
                Reserved {yoctoToNear(reserved.toString())}
              </span>
              <span>
                <i className="mr-2 inline-block size-2 bg-fog" aria-hidden />
                Left {yoctoToNear(left.toString())} of {yoctoToNear(near.dailyCap)} NEAR
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">This agent has no NEAR limit.</p>
        )}
      </Panel>
      <Panel title="Sent through this vault">
        <p className="-mt-2 mb-4 max-w-[70ch] text-sm text-muted">
          This is what passed through the vault, not the position&apos;s current value. The vault cannot read the target&apos;s state, and payouts use this
          figure. It is counted per vault and target, not per agent.
        </p>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th className={th}>Target</th>
                  <th className={th}>Class when recorded</th>
                  <th className={`${th} text-right`}>Sent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.target}-${r.token ?? "near"}`}>
                    <td className={`${td} mono break-all`}>{r.target}</td>
                    <td className={td}>{["immutable_verified", "local_upgradeable", "global_by_account", "unknown"].includes(r.classAtRecord) ? <ClassTag c={r.classAtRecord as "unknown"} target={r.target} /> : r.classAtRecord}</td>
                    <td className={`${td} mono whitespace-nowrap text-right`}>
                      {yoctoToNear(r.amount)} {r.token && r.token !== "near" ? r.token : "NEAR"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No exposure yet. The first call through the vault records it.</p>
        )}
      </Panel>
    </div>
  );
}

function PolicyTab({ live, a, actor, reason }: { live: Extract<LiveVault, { status: "ok" }>; a: AgentView; actor: ActorRole | null; reason: string }) {
  const acts = useLiveActions(live.vault, live.refresh);
  const ceiling = live.view.ceiling;
  const current = useMemo(
    () => draftToPolicy({ ...draftFromPolicy({ limits: a.policy.limits ?? [{ token: "near", maxPerTx: a.policy.maxPerTx, dailyCap: a.policy.dailyCap }], maxSlippageBps: a.policy.maxSlippageBps, allowedTargets: a.policy.allowedTargets, maxRiskClass: a.policy.maxRiskClass as "unknown" }) }),
    [a],
  );
  const [d, setD] = useState(() => draftFromPolicy(current));
  const [options, setOptions] = useState<TargetOption[]>([]);
  const reads = useMemo(() => createTestnetReads(), []);

  useEffect(() => {
    if (!ceiling) return;
    let alive = true;
    readFactory(reads)
      .then((f) => classifiedTargets(reads, f.registry, ceiling.allowedTargets))
      .then((t) => alive && setOptions(t))
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [ceiling, reads]);

  if (!ceiling) return <p className="text-sm text-muted">This vault version does not expose a ceiling, so a policy cannot be checked against it. Nothing is signed.</p>;

  const next = draftToPolicy(d);
  const problem = policyProblem(next, ceiling);
  const tighter = isTighter(current, next);
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  const operatorLoosens = actor === "operator" && !tighter;
  const revoked = a.status === "Revoked";
  const message = revoked ? "This agent is revoked; its policy can no longer change." : !actor ? reason : operatorLoosens ? "An operator can only tighten a policy. Ask the client to loosen it." : problem?.message ?? null;
  const invalid = revoked || !actor || !changed || !!problem || operatorLoosens;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Panel
        title="Save a policy change"
        aside={
          <Button type="button" disabled={invalid} onClick={() => acts.setPolicy(a.publicKey, a.label, next, tighter)}>
            {changed && !tighter ? "Loosen the policy" : "Save the policy"}
          </Button>
        }
      >
        <p className="text-sm text-slate">
          {!changed ? "No change from the current policy." : tighter ? "This change only tightens the policy." : "This change loosens the policy, which only the owner can do."}
        </p>
        {message && <p className="mt-3 text-sm text-dawn-ink">{message}</p>}
      </Panel>

      <PricePanel live={live} a={a} draft={{ cap: d.cap, maxClass: d.maxClass, targets: d.targets }} />

      <Panel title="Economic limits">
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField label="Max per transaction" suffix={<TokenIcon t="NEAR" />} step={0.05} value={d.maxTx} onChange={(v) => setD({ ...d, maxTx: v })} />
            <NumberField label="Daily cap" suffix={<TokenIcon t="NEAR" />} step={0.1} value={d.cap} onChange={(v) => setD({ ...d, cap: v })} />
            <NumberField label="Max slippage" suffix="%" step={0.05} value={d.slipPct} onChange={(v) => setD({ ...d, slipPct: v })} />
          </div>
          <ClassPicker value={d.maxClass} onChange={(maxClass) => setD({ ...d, maxClass })} />
          <fieldset>
            <legend className="text-sm font-medium">Allowed contracts</legend>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {ceiling.allowedTargets.map((t) => {
                const o = options.find((x) => x.target === t);
                const on = d.targets.includes(t);
                return (
                  <li key={t}>
                    <label className="flex cursor-pointer items-start gap-3 border border-line p-3 has-[:checked]:border-ink">
                      <input type="checkbox" className="mt-1 accent-ink" checked={on} onChange={() => setD({ ...d, targets: on ? d.targets.filter((x) => x !== t) : [...d.targets, t] })} />
                      <span>
                        <span className="mono block break-all text-sm">{t}</span>
                        {o && <ClassTag c={o.class} target={t} />}
                        {o?.frozen && <span className="mono ml-2 text-xs text-dawn-ink">frozen</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </div>
      </Panel>
    </div>
  );
}

function ActivityTab({ live, a }: { live: Extract<LiveVault, { status: "ok" }>; a: AgentView }) {
  const { history, activity, exposure } = useVaultHistory(live.vault, { agent: a.publicKey, refreshKey: live.view });
  const [f, setF] = useState<"all" | "refused" | "other">("all");
  const list = newestFirst(activity).filter((e) => f === "all" || (f === "refused" ? e.kind === "refused" : e.kind !== "refused"));

  return (
    <div className="grid gap-6">
      <Panel
        title="On-chain events"
        aside={
          <div role="group" aria-label="Filter events" className="flex border border-line-2">
            {(
              [
                ["all", "All"],
                ["refused", "Refusals"],
                ["other", "Everything else"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                aria-pressed={f === k}
                onClick={() => setF(k)}
                className="cursor-pointer px-3 py-1.5 text-sm transition-colors hover:bg-wash aria-pressed:bg-ink aria-pressed:text-paper"
              >
                {l}
              </button>
            ))}
          </div>
        }
      >
        <p className="-mt-2 mb-4 max-w-[70ch] text-sm text-muted">
          NEP-297 events with standard &quot;aruna&quot;. A refusal is the product working, so it is recorded like any other event.
        </p>
        <HistoryBlock h={activity} source={history.source}>
          <ActivityList items={list} empty="No events match this filter." />
        </HistoryBlock>
      </Panel>
      <Panel title="Exposure of this agent">
        <HistoryBlock h={exposure} source={history.source}>
          <ExposureHistory rows={newestFirst(exposure)} empty="This agent has not sent anything that settled." />
        </HistoryBlock>
      </Panel>
    </div>
  );
}

function FundingTab({ live, a }: { live: Extract<LiveVault, { status: "ok" }>; a: AgentView }) {
  const allowance = a.key?.allowance ?? null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Panel title="Fee allowance" aside={<span className="text-[28px] leading-none">{allowance === null ? "none" : yoctoToNear(allowance)} <small className="text-base text-muted">NEAR</small></span>}>
        <p className="-mt-2 mb-5 text-sm leading-[1.6] text-muted">
          A classic allowance on the key, paid from the vault&apos;s balance. The owner&apos;s ceiling sets it when an agent is added. This console cannot change it
          on an existing key.
        </p>
        <p className="text-sm text-muted">
          The vault&apos;s funds, deposit and withdraw are on the{" "}
          <Link href={`/console/vault/detail/?vault=${encodeURIComponent(live.vault)}`} className="underline underline-offset-4">
            Vault page
          </Link>
          .
        </p>
      </Panel>
    </div>
  );
}

function AccessTab({ live, a }: { live: Extract<LiveVault, { status: "ok" }>; a: AgentView }) {
  const refused = ACCESS_KEY_ROWS.filter((r) => !r.action.startsWith("Parent"));
  const note =
    a.status === "Revoked"
      ? "This key was deleted. The network rejects its transactions, so they never execute."
      : a.autoDisabled
        ? "The vault auto-disabled this agent. Its next call returns ARUNA_AGENT_AUTO_DISABLED."
        : a.status === "Paused"
          ? "This agent is paused. Its next call returns ARUNA_AGENT_NOT_ACTIVE."
          : "Revoking deletes this key, and the network then refuses it.";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Panel title="What the protocol refuses this key">
        <p className="-mt-2 mb-4 max-w-[80ch] text-sm leading-[1.6] text-muted">
          Results from our lab on nearcore 2.14, protocol 88, single-shard sandbox, using gas keys on sub-accounts. This design uses classic keys on a contract,
          so T5 to T9 must re-test it. These are refused before a block, so a script prints the proof rather than an explorer link.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[15px]">
            <thead>
              <tr>
                <th className={th}>Attempt</th>
                <th className={th}>Exact error</th>
              </tr>
            </thead>
            <tbody>
              {refused.map((r) => (
                <tr key={r.action}>
                  <td className={td}>{r.action}</td>
                  <td className={`${td} mono text-dawn-ink`}>{r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="This key">
        <dl className="grid gap-3 text-sm sm:grid-cols-[160px_1fr]">
          <dt className="text-muted">Public key</dt>
          <dd>
            <span className="mono break-all">{a.publicKey}</span>
            <span className="mt-1 block text-muted">Migrating to a new vault issues a new key. The label and policy carry over.</span>
          </dd>
          <dt className="text-muted">Label</dt>
          <dd>{a.label}</dd>
          <dt className="text-muted">Type</dt>
          <dd className="mono">{a.key ? "FunctionCall, with allowance" : "Deleted"}</dd>
          <dt className="text-muted">Receiver</dt>
          <dd className="mono break-all">{a.key?.receiver ?? live.vault}</dd>
          <dt className="text-muted">Methods</dt>
          <dd className="mono">{a.key ? a.key.methods.join(", ") : "none"}</dd>
          <dt className="text-muted">Method list</dt>
          <dd>
            <ClassTag c={a.policy.maxRiskClass as "unknown"} /> tier
            <span className="mt-1 block text-muted">Set by the riskiest class allowed, so the protocol enforces part of the policy.</span>
          </dd>
        </dl>
        <p className="mt-5 border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]">{note}</p>
        <p className="label mt-6 mb-2 text-xs text-muted">One call lists the whole fleet</p>
        <CopyBlock text={curlFor("view_access_key_list", live.vault, "testnet")} />
      </Panel>
    </div>
  );
}
