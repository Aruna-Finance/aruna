"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { Select } from "@/shared/Select";
import { COVERAGE_ASSUME, heartbeatStale } from "../data/coverage";
import { attestorFor, coverageStore, quoteCoverage } from "../data/coverage-mock";
import { days, n0, n2 } from "../fmt";
import { useActions } from "../useActions";
import { useCoverage } from "../useCoverage";
import { useTargets } from "../useTargets";
import { ClassTag } from "../ui/ClassTag";
import { NumberField } from "../ui/Field";
import { NotCovered } from "../ui/CoverageNotes";
import { Panel } from "../ui/Panel";

export function CoverageBuy() {
  const { vault, isOperator, ask, run } = useActions();
  const { attestors } = useCoverage();
  const { list, classes } = useTargets();
  const router = useRouter();
  const preset = useSearchParams().get("agent");

  const live = vault.agents.filter((a) => a.status !== "Revoked");
  const [agentId, setAgentId] = useState(live.find((a) => a.id === preset)?.id ?? live[0]?.id ?? "");
  const agent = live.find((a) => a.id === agentId) ?? live[0];
  const targets = agent?.policy.allowedTargets ?? [];
  const [targetPick, setTargetPick] = useState("");
  const target = targets.includes(targetPick) ? targetPick : (targets[0] ?? "");
  const [limit, setLimit] = useState(500);
  const [period, setPeriod] = useState(30);
  const [ratio, setRatio] = useState(COVERAGE_ASSUME.defaultPayoutBps / 100);
  const [ack, setAck] = useState(false);

  const cls = classes[target];
  const frozen = list.find((t) => t.id === target)?.frozen ?? false;
  const attestor = attestors.find((a) => a.id === attestorFor(target));
  const silent = attestor ? heartbeatStale(attestor) : false;

  const quote = useMemo(
    () =>
      agent
        ? quoteCoverage({
            cls,
            dailyCap: agent.policy.dailyCap,
            slippagePct: agent.policy.maxSlippageBps / 100,
            limit: limit || 0,
            days: period || 0,
            payoutBps: (ratio || 0) * 100,
            utilization: coverageStore.utilization(),
          })
        : null,
    [agent, cls, limit, period, ratio],
  );
  const checks = quote?.priced ? coverageStore.checks(target, quote.limit) : null;
  const ready = !!quote?.priced && !frozen && !silent && !!checks?.ok && ack && limit > 0 && period > 0 && ratio > 0 && ratio <= 100;

  if (isOperator) {
    return (
      <article>
        <p className="text-sm text-muted">
          <Link href="/console/coverage/" className="underline underline-offset-4">
            Coverage
          </Link>{" "}
          / Buy
        </p>
        <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">The client buys coverage</h1>
        <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">Coverage is an owner action, never available to an operator or an agent key.</p>
      </article>
    );
  }

  function buy() {
    if (!agent || !quote) return;
    ask({
      title: "Buy this coverage?",
      receiver: "aruna.testnet",
      actions: [`cover ${target} for ${agent.id}`],
      note: `Coverage starts after a ${days(COVERAGE_ASSUME.waitingPeriodSec)} waiting period. A change before that pays nothing. This stops an owner who also controls the target from buying cover and then upgrading.`,
      okLabel: "Buy this coverage",
      onOk: () =>
        run(() => {
          coverageStore.buy({ agent: agent.id, target, limit, days: period, payoutBps: ratio * 100 }, quote);
          router.push("/console/coverage/");
        }, "Coverage bought. The waiting period has started."),
    });
  }

  return (
    <article>
      <p className="text-sm text-muted">
        <Link href="/console/coverage/" className="underline underline-offset-4">
          Coverage
        </Link>{" "}
        / Buy
      </p>
      <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">Buy coverage on one target</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        You choose the limit and the payout ratio. The price follows the target&apos;s class and the most this agent&apos;s policy allows.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Premium" aside={<span className="text-sm text-muted">Assumed numbers, see the list below</span>}>
          {frozen ? (
            <p className="border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm">
              <span className="mono">{target}</span> is frozen by a drift report, so it cannot be covered now.
            </p>
          ) : !quote || !quote.priced ? (
            <div>
              <p className="text-[28px] leading-[1.1]">Not priced</p>
              <p className="mt-2 max-w-[70ch] text-sm text-muted">
                {quote?.reason} A risk product that prints a number here would be wrong on the first event.
              </p>
            </div>
          ) : silent ? (
            <p className="border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]">
              The attestor assigned to <span className="mono">{target}</span>, <span className="mono">{attestor?.id}</span>, last reported{" "}
              {n0(attestor?.heartbeatAgeBlocks ?? 0)} blocks ago. Coverage cannot be sold on this target while drift detection is unverified.
            </p>
          ) : (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-[28px] leading-[1.1]">
                  {n2(quote.total)}
                  <small className="ml-1 text-base text-muted">USDC</small>
                </p>
                <p className="text-sm text-muted">
                  {quote.pctOfLimit.toFixed(1)}% of a {n0(quote.limit)} USDC limit, for {period} days. P(event) {(quote.p * 100).toFixed(2)}% is
                  an assumption: it cannot come from the chain.
                </p>
              </div>
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["Expected loss", quote.expectedLoss],
                    ["Capital cost", quote.capitalCost],
                    ["Monitoring and operations", quote.opsCost],
                    ["Risk margin", quote.riskMargin],
                  ] as const
                ).map(([l, v]) => (
                  <div key={l}>
                    <dt className="text-muted">{l}</dt>
                    <dd className="mono">{n2(v)}</dd>
                  </div>
                ))}
              </dl>
              {quote.limit < limit && (
                <p className="text-sm text-slate">The limit is capped at {n0(quote.limit)} USDC, the most this policy can send in {period} days.</p>
              )}
              {checks && (
                <div>
                  <p className="label mb-2 text-xs text-muted">Pool checks</p>
                  <ul className="grid gap-1 text-sm">
                    <li className={checks.adequacy.ok ? "" : "text-dawn-ink"}>
                      Capital adequacy: {n0(checks.adequacy.after)} of {n0(checks.adequacy.max)} USDC
                    </li>
                    <li className={checks.concentration.ok ? "" : "text-dawn-ink"}>
                      Concentration on implementation <span className="mono">{checks.concentration.group}</span>: {n0(checks.concentration.after)} of{" "}
                      {n0(checks.concentration.cap)} USDC
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!ready} onClick={buy}>
              Buy this coverage
            </Button>
            {quote?.priced && checks && !checks.ok && (
              <span className="text-sm text-dawn-ink">
                {!checks.concentration.ok
                  ? "This implementation is at its concentration limit. Lower the limit or pick another target."
                  : "The pool is at its capital adequacy limit."}
              </span>
            )}
            {quote?.priced && checks?.ok && !silent && !frozen && !ack && (
              <span className="text-sm text-muted">Confirm what is not covered to continue.</span>
            )}
          </div>
        </Panel>

        <Panel title="Policy">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-sm font-medium">Agent</p>
              <Select
                label="Agent"
                value={agent?.id ?? ""}
                onValueChange={setAgentId}
                options={live.map((a) => ({ value: a.id, label: a.label }))}
                className="mt-1.5 w-full"
              />
              <p className="mono mt-1.5 text-sm text-muted">{agent?.id}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Target on its allowed list</p>
              <Select
                label="Target"
                value={target}
                onValueChange={setTargetPick}
                options={targets.map((t) => ({ value: t, label: t }))}
                className="mt-1.5 w-full"
              />
              <p className="mt-1.5 text-sm">{cls ? <ClassTag c={cls} /> : <span className="text-muted">Loading</span>}</p>
            </div>
            <NumberField label="Coverage limit" suffix="USDC" min={1} value={limit} onChange={setLimit} />
            <NumberField label="Duration" suffix="days" min={1} value={period} onChange={setPeriod} />
            <NumberField
              label="Payout ratio"
              suffix="%"
              min={1}
              value={ratio}
              onChange={setRatio}
              hint="The 80% default comes from the worked example in the overview doc (assumption)."
            />
            <div>
              <p className="text-sm font-medium">Timeline</p>
              <p className="mt-2 text-sm text-slate">
                Waiting period {days(COVERAGE_ASSUME.waitingPeriodSec)}, then active. Any payout follows a{" "}
                {days(COVERAGE_ASSUME.challengeWindowSec)} challenge window. Both are assumptions.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Who you trust">
          <p className="max-w-[80ch] text-[15px] leading-[1.6]">
            Two parties: the <strong className="font-medium">attestor</strong> reports whether code changed and at which block, and is
            permanently a trust assumption. The <strong className="font-medium">arbiter</strong> resolves conflicting reports. Aruna runs
            both at this stage, in public.
          </p>
          <p className="mt-3 max-w-[80ch] text-sm text-muted">
            Recorded exposure is what passed through the vault, not the position&apos;s current value. The vault cannot read the target&apos;s
            state, and payouts use this figure.
          </p>
        </Panel>


        <Panel title="What this does not cover">
          <NotCovered />
          <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-ink" />
            <span>I understand payment follows the trigger, and is not a measure of what I lost.</span>
          </label>
        </Panel>
      </div>
    </article>
  );
}
