"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { ACCESS_KEY_ROWS, REFUSALS } from "@/landing/lib/facts";
import { curlFor } from "@/landing/lib/verify-commands";
import { vaultStore } from "../data/vault-mock";
import { ceilingProblem, isTightening, type AgentRecord } from "../data/vault";
import { block, n0, n2 } from "../fmt";
import { policyPrice } from "../pricing";
import { useActions } from "../useActions";
import { useCoverage } from "../useCoverage";
import { useTargets } from "../useTargets";
import { BudgetBar, BudgetLegend } from "../ui/BudgetBar";
import { ClassTag } from "../ui/ClassTag";
import { CopyBlock } from "../ui/CopyBlock";
import { CoverageTable } from "../ui/CoverageTable";
import { NumberField } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { ClassPicker, draftFrom, LimitFields, TargetPicker, toPolicy, type PolicyDraft } from "../ui/PolicyFields";
import { StatusChip } from "../ui/StatusChip";
import { Tabs } from "../ui/Tabs";
import { TokenIcon } from "../ui/Token";

type Tab = "overview" | "policy" | "activity" | "funding" | "coverage" | "access";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "policy", label: "Policy" },
  { id: "activity", label: "Activity" },
  { id: "funding", label: "Funds and allowance" },
  { id: "coverage", label: "Coverage" },
  { id: "access", label: "Key and proof" },
];

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

/** Counted refusals: the reasons that feed the auto-disable score (docs/CONTRACTS.md). */
const COUNTED = new Set(REFUSALS.filter((r) => r.counts).map((r) => r.reason.replace(/^ARUNA_/, "")));

function NotFound({ id }: { id: string | null }) {
  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Agent not found</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        {id ? <>No agent called <span className="mono">{id}</span> exists on this vault.</> : "No agent was named in the link."}{" "}
        <Link href="/console/agents/" className="underline underline-offset-4">
          Back to the agent list
        </Link>
        .
      </p>
    </article>
  );
}

export function AgentDetail() {
  const id = useSearchParams().get("id");
  const { vault } = useActions();
  const agent = vault.agents.find((a) => a.id === id);
  return agent ? <Detail key={agent.id} agent={agent} /> : <NotFound id={id} />;
}

function Detail({ agent: a }: { agent: AgentRecord }) {
  const [tab, setTab] = useState<Tab>("overview");
  const { vault, isOperator, freeze, resume, revoke } = useActions();
  const counted = vault.events.filter((e) => e.agent === a.id && e.code && COUNTED.has(e.code)).length;

  return (
    <article>
      <p className="text-sm text-muted">
        <Link href="/console/agents/" className="underline underline-offset-4">
          Agents
        </Link>{" "}
        / <span className="mono">{a.publicKey}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-[clamp(28px,4vw,44px)]">{a.label}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusChip a={a} />
            <span className="text-sm text-muted">
              Counted refusals {counted} · Added {block(a.addedBlock)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {a.status === "Active" && (
            <Button type="button" variant="dark" onClick={() => freeze(a)}>
              Freeze agent
            </Button>
          )}
          {a.status === "Paused" && !isOperator && (
            <Button type="button" onClick={() => resume(a)}>
              Resume agent
            </Button>
          )}
          {a.status === "Paused" && (
            <Button type="button" variant="dark" onClick={() => revoke(a)}>
              Revoke agent
            </Button>
          )}
        </div>
      </div>

      <div className="mt-8">
        <Tabs tabs={TABS} value={tab} onChange={setTab}>
          {tab === "overview" && <OverviewTab a={a} />}
          {tab === "policy" && <PolicyTab a={a} />}
          {tab === "activity" && <ActivityTab a={a} />}
          {tab === "funding" && <FundingTab a={a} />}
          {tab === "coverage" && <CoverageTab a={a} />}
          {tab === "access" && <AccessTab a={a} />}
        </Tabs>
      </div>
    </article>
  );
}

function OverviewTab({ a }: { a: AgentRecord }) {
  const { classes } = useTargets();
  const rows = Object.entries(a.exposure);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Panel title="Today's budget" aside={<span className="mono text-sm text-muted">Vault balance {n0(a.balance)} USDC</span>}>
        <BudgetBar a={a} wide />
        <BudgetLegend a={a} />
      </Panel>
      <Panel title="Recorded exposure">
        <p className="-mt-2 mb-4 max-w-[70ch] text-sm text-muted">
          This is what passed through the vault, not the position&apos;s current value. The vault cannot read the target&apos;s state,
          and payouts use this figure.
        </p>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th className={th}>Target</th>
                  <th className={th}>Class</th>
                  <th className={`${th} text-right`}>Sent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([t, amount]) => (
                  <tr key={t}>
                    <td className={`${td} mono`}>{t}</td>
                    <td className={td}>{classes[t] ? <ClassTag c={classes[t]} /> : <span className="text-muted">Loading</span>}</td>
                    <td className={`${td} mono whitespace-nowrap text-right`}>{n0(amount)} USDC</td>
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

function PolicyTab({ a }: { a: AgentRecord }) {
  const { vault, actor, isOperator, ask, run } = useActions();
  const { list, classes, classOf } = useTargets();
  const [d, setD] = useState<PolicyDraft>(() => draftFrom(a.policy));
  const next = useMemo(() => toPolicy(d, classOf), [d, classes]); // eslint-disable-line react-hooks/exhaustive-deps
  const before = policyPrice(a.policy, classOf);
  const after = policyPrice(next, classOf);
  const diff = before.priced && after.priced ? after.total - before.total : null;
  const ceiling = ceilingProblem(vault, next, a.id);
  const loosens = isOperator && !isTightening(a.policy, next);
  const invalid = !(d.maxTx > 0) || !(d.cap > 0) || d.maxTx > d.cap || !!ceiling || loosens || a.status === "Revoked";
  const message = loosens
    ? "An operator can only tighten a policy. Ask the client to loosen it."
    : ceiling ?? (d.maxTx > d.cap ? "Max per transaction cannot exceed the daily cap." : null);

  function save() {
    ask({
      title: "Update this policy?",
      actions: ["update policy"],
      note: "The vault applies new limits from the next call. Existing exposure records do not change.",
      onOk: () => run(() => vaultStore.applyPolicy(a.id, next, actor), "Policy updated. Event policy_updated was emitted."),
    });
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Panel title="Premium with these limits" aside={<span className="text-sm text-muted">Mock model, assumptions apply</span>}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            {after.priced ? (
              <p className="text-[28px] leading-[1.1]">
                {n2(after.total)}
                <small className="ml-1 text-base text-muted">USDC per 30 days</small>
              </p>
            ) : (
              <p className="text-[28px] leading-[1.1]">Not priced</p>
            )}
            <p className="mt-2 text-sm text-slate">
              {diff == null
                ? after.priced
                  ? "Becomes priced with this change."
                  : "An unknown target is allowed, so no premium exists."
                : diff === 0
                  ? "No change from the current policy."
                  : `${diff < 0 ? "-" : "+"}${n2(Math.abs(diff))} USDC against the current ${before.priced ? n2(before.total) : ""}.`}{" "}
              30-day maximum {n0((d.cap || 0) * 30)} USDC.
            </p>
          </div>
          <Button type="button" disabled={invalid} onClick={save}>
            Save the policy
          </Button>
        </div>
        {message && <p className="mt-3 text-sm text-dawn-ink">{message}</p>}
      </Panel>

      <Panel title="Economic limits">
        <div className="grid gap-6">
          <LimitFields d={d} set={setD} />
          <ClassPicker value={d.maxClass} onChange={(maxClass) => setD({ ...d, maxClass })} />
          <TargetPicker targets={list} classes={classes} d={d} set={setD} frozen={list.filter((t) => t.frozen).map((t) => t.id)} />
        </div>
      </Panel>
    </div>
  );
}

function ActivityTab({ a }: { a: AgentRecord }) {
  const { vault } = useActions();
  const [f, setF] = useState<"all" | "refused" | "other">("all");
  const list = vault.events.filter(
    (e) => e.agent === a.id && (f === "all" || (f === "refused" ? e.type === "execution_rejected" : e.type !== "execution_rejected")),
  );
  return (
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
      {list.length ? (
        <ul className="grid gap-3 text-sm">
          {list.map((e) => (
            <li key={e.id} className="grid gap-0.5 border-t border-line pt-3">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={`mono text-xs ${e.type === "execution_rejected" ? "text-dawn-ink" : "text-muted"}`}>{e.type}</span>
                <span className="mono text-xs text-muted">{block(e.block)}</span>
              </span>
              <span>
                {e.target && <span className="mono text-muted">to {e.target} </span>}
                {e.code && <span className="mono text-dawn-ink">ARUNA_{e.code} </span>}
                {e.detail && <span className="text-muted">{e.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No events match this filter.</p>
      )}
    </Panel>
  );
}

function FundingTab({ a }: { a: AgentRecord }) {
  const { vault, actor, isOperator, ask, run } = useActions();
  const [dep, setDep] = useState(0);
  const [wd, setWd] = useState(0);
  const [gas, setGas] = useState(a.allowanceNear);
  useEffect(() => setGas(a.allowanceNear), [a.allowanceNear]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
      <Panel title="Balance in the vault" aside={<span className="text-[28px] leading-none">{n0(a.balance)} <small className="text-base text-muted">USDC</small></span>}>
        <p className="-mt-2 mb-5 text-sm text-muted">The vault holds the funds. The agent holds none.</p>
        <div className="grid gap-5">
          <div className="grid gap-3">
            <NumberField label="Deposit" suffix={<TokenIcon t="USDC" />} value={dep} onChange={setDep} />
            <div>
              <Button
                type="button"
                disabled={!(dep > 0)}
                onClick={() =>
                  ask({
                    title: `Deposit ${n0(dep)} USDC?`,
                    receiver: "usdc.testnet",
                    actions: [`ft_transfer_call to ${vault.vault}, 1 yoctoNEAR`],
                    onOk: () => run(() => vaultStore.deposit(a.id, dep), "Deposit credited to this agent in the vault."),
                  })
                }
              >
                Deposit USDC
              </Button>
            </div>
          </div>
          {isOperator ? (
            <p className="text-sm text-muted">Only the client can withdraw, and only to its own account.</p>
          ) : (
            <div className="grid gap-3">
              <NumberField
                label={`Withdraw to ${vault.owner}`}
                suffix={<TokenIcon t="USDC" />}
                value={wd}
                onChange={setWd}
                hint="Only the owner can do this, in any state, and only to the owner's account."
              />
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!(wd > 0)}
                  onClick={() =>
                    ask({
                      title: `Withdraw ${n0(wd)} USDC?`,
                      actions: [`withdraw_to_owner: ${vault.owner}`],
                      note: "Owner-only, never an agent action. Funds can only go to the registered owner.",
                      onOk: () => run(() => vaultStore.withdraw(a.id, wd, actor), "Withdrawn to the owner."),
                    })
                  }
                >
                  Withdraw to owner
                </Button>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Gas allowance" aside={<span className="text-[28px] leading-none">{a.allowanceNear} <small className="text-base text-muted">NEAR</small></span>}>
        <p className="-mt-2 mb-5 text-sm text-muted">A classic allowance on the key, paid from the vault&apos;s balance.</p>
        <div className="grid gap-3">
          <NumberField
            label="New allowance"
            suffix={<TokenIcon t="NEAR" />}
            step={0.01}
            value={gas}
            onChange={setGas}
            hint="Behaviour when an allowance runs out is test T6, still pending."
          />
          {isOperator ? (
            <p className="text-sm text-muted">Only the client can raise an allowance.</p>
          ) : (
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={!(gas > 0)}
                onClick={() =>
                  ask({
                    title: `Set the gas allowance to ${gas} NEAR?`,
                    actions: ["delete key, then add it with the new allowance, in one batch from the contract"],
                    onOk: () => run(() => vaultStore.setAllowance(a.id, gas, actor), "Gas allowance replaced."),
                  })
                }
              >
                Replace the allowance
              </Button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function CoverageTab({ a }: { a: AgentRecord }) {
  const { isOperator } = useActions();
  const { policies } = useCoverage();
  const mine = policies.filter((p) => p.agent === a.id);
  return (
    <Panel
      title="Coverage policies"
      aside={
        !isOperator && (
          <Link href={`/console/coverage/buy/?agent=${encodeURIComponent(a.id)}`} tabIndex={-1}>
            <Button type="button" className="px-4! py-2! text-sm!">
              Buy coverage
            </Button>
          </Link>
        )
      }
    >
      {mine.length ? <CoverageTable policies={mine} /> : <p className="text-sm text-muted">No coverage on this agent. It still runs under its limits.</p>}
    </Panel>
  );
}

function AccessTab({ a }: { a: AgentRecord }) {
  const { vault } = useActions();
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
          Results from our lab on nearcore 2.14, protocol 88, single-shard sandbox, using gas keys on sub-accounts. This design uses
          classic keys on a contract, so T5 to T9 must re-test it. These are refused before a block, so a script prints the proof
          rather than an explorer link.
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
            <span className="mono">{a.publicKey}</span>
            <span className="mt-1 block text-muted">Migrating to a new vault issues a new key. The label and policy carry over.</span>
          </dd>
          <dt className="text-muted">Label</dt>
          <dd>{a.label}</dd>
          <dt className="text-muted">Type</dt>
          <dd className="mono">FunctionCall, with allowance</dd>
          <dt className="text-muted">Receiver</dt>
          <dd className="mono">{vault.vault}</dd>
          <dt className="text-muted">Method list</dt>
          <dd>
            <ClassTag c={a.policy.maxRiskClass} /> tier
            <span className="mt-1 block text-muted">Set by the riskiest class allowed, so the protocol enforces part of the policy.</span>
          </dd>
        </dl>
        <p className="mt-5 border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]">{note}</p>
        <p className="label mt-6 mb-2 text-xs text-muted">One call lists the whole fleet</p>
        <CopyBlock text={curlFor("view_access_key_list", vault.vault, "testnet")} />
      </Panel>
    </div>
  );
}
