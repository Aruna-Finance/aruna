"use client";

import { quoteCoverage, type QuoteResult } from "@aruna/sdk/coverage";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { Select } from "@/shared/Select";
import { buyRequestOf, DEFAULT_DAYS, DEFAULT_RATIO_PCT, formProblem, watchProblem, type BuyForm, type Watch } from "../data/coverage-buy";
import { describeQuote } from "../data/price";
import { yoctoToNear } from "../fmt";
import { liveQuoteDeps } from "../quote-live";
import { readWatch, useCoverageBuy } from "../useCoverageBuy";
import { useLiveVault, type LiveVault } from "../useLiveVault";
import { useWallet } from "../WalletContext";
import { relationOf } from "../walletRole";
import { NumberField } from "../ui/Field";
import { NotCovered } from "../ui/CoverageNotes";
import { NoVault } from "../ui/NoVault";
import { Panel } from "../ui/Panel";

const DEBOUNCE_MS = 400;

export function CoverageBuy() {
  const live = useLiveVault();
  if (live.status !== "ok") return <NoVault live={live} title="Buy coverage on one target" />;
  return <LiveBuy live={live} />;
}

function Crumb({ vault }: { vault: string }) {
  return (
    <p className="text-sm text-muted">
      <Link href={`/console/coverage/?vault=${encodeURIComponent(vault)}`} className="underline underline-offset-4">
        Coverage
      </Link>{" "}
      / Buy
    </p>
  );
}

function LiveBuy({ live }: { live: Extract<LiveVault, { status: "ok" }> }) {
  const { vault, view } = live;
  const { accountId } = useWallet();
  const relation = relationOf(accountId, view);
  const router = useRouter();
  const preset = useSearchParams().get("agent");

  const agents = view.agents.filter((a) => a.status !== "Revoked");
  const [agentKey, setAgentKey] = useState(agents.find((a) => a.publicKey === preset)?.publicKey ?? agents[0]?.publicKey ?? "");
  const agent = agents.find((a) => a.publicKey === agentKey) ?? agents[0];
  const targets = agent?.policy.allowedTargets ?? [];
  const [targetPick, setTargetPick] = useState("");
  const target = targets.includes(targetPick) ? targetPick : (targets[0] ?? "");
  const [limitNear, setLimit] = useState(1);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [ratioPct, setRatio] = useState(DEFAULT_RATIO_PCT);
  const [ack, setAck] = useState(false);

  const form: BuyForm = { vault, agentPublicKey: agent?.publicKey ?? "", target, limitNear, days, ratioPct };
  const problem = formProblem(form);

  const [watch, setWatch] = useState<Watch | null>(null);
  const [watchFailed, setWatchFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    let alive = true;
    setWatch(null);
    setWatchFailed(null);
    readWatch(target)
      .then((w) => alive && setWatch(w))
      .catch((e: unknown) => alive && setWatchFailed(e instanceof Error ? e.message : "The registry could not be read."));
    return () => {
      alive = false;
    };
  }, [target]);
  const blocked = watchProblem(target, watch);

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteFailed, setQuoteFailed] = useState<string | null>(null);
  const deps = useMemo(() => liveQuoteDeps(view), [view]);
  const request = useMemo(() => (problem || !agent || !target ? null : buyRequestOf(form)), [problem, agent, target, vault, limitNear, days, ratioPct]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!request) {
      setQuote(null);
      return;
    }
    let alive = true;
    setQuoteFailed(null);
    const t = setTimeout(() => {
      quoteCoverage(deps, { ...request, token: "near" })
        .then((r) => alive && setQuote(r))
        .catch((e: unknown) => alive && (setQuote(null), setQuoteFailed(e instanceof Error ? e.message : "The pool could not be reached.")));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [request, deps]);

  const buy = useCoverageBuy(vault, () => router.push(`/console/coverage/?vault=${encodeURIComponent(vault)}`));
  const cell = quote ? describeQuote(quote) : null;
  const ready = relation === "owner" && !!request && quote?.ok === true && !blocked && watch !== null && ack;

  if (relation === "operator") {
    return (
      <article>
        <Crumb vault={vault} />
        <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">The owner buys coverage</h1>
        <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">Coverage is an owner action, never available to an operator or an agent key.</p>
      </article>
    );
  }

  function send() {
    if (!ready || !request || !quote?.ok || !agent) return;
    buy({
      request,
      maxPremiumYocto: quote.quote.premium,
      actions: [`cover ${target} for ${agent.label}`, `limit ${yoctoToNear(request.limit)} NEAR, ${days} days, payout ratio ${ratioPct}%`],
    });
  }

  return (
    <article>
      <Crumb vault={vault} />
      <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">Buy coverage on one target</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Pick an agent and a contract, then a limit and a payout ratio. The price is the pool&apos;s own quote. Testnet, in NEAR.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Premium" aside={<span className="text-sm text-muted">Testnet, assumed numbers</span>}>
          {!agent ? (
            <p className="text-sm text-muted">This vault has no agent that is not revoked, so there is nothing to cover.</p>
          ) : problem ? (
            <p className="text-sm text-muted">{problem}</p>
          ) : quoteFailed ? (
            <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not get a price from the pool. {quoteFailed}</p>
          ) : !cell ? (
            <p className="text-sm text-muted">Asking the pool.</p>
          ) : cell.kind === "refused" ? (
            <div>
              <p className="text-[28px] leading-[1.1]">Not priced</p>
              <p className="mt-2 max-w-[70ch] text-sm text-muted" title={cell.detail}>
                {cell.text} A risk product that prints a number here would be wrong on the first event.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              <p className="text-[28px] leading-[1.1]">
                {cell.premium}
                <small className="ml-1 text-base text-muted">NEAR</small>
              </p>
              <p className="text-sm text-muted">
                For a {days} day window, class {cell.cls}. The coverage can pay out up to {cell.reachable} NEAR, bounded by the agent&apos;s daily
                cap. P(event) is an assumption of the pool, not a measurement.
              </p>
              {quote?.ok && <p className="mono text-xs text-muted">{quote.quote.assumptions.label}</p>}
            </div>
          )}
          {watchFailed && <p className="mt-4 text-sm text-dawn-ink">Could not read the attestor state. {watchFailed}</p>}
          {blocked && <p className="mt-4 border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]">{blocked}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!ready} onClick={send}>
              Buy this coverage
            </Button>
            {relation !== "owner" && (
              <span className="text-sm text-muted">{accountId ? "Only the vault's owner can buy." : "Connect the owner's wallet to buy."}</span>
            )}
            {relation === "owner" && quote?.ok && !blocked && !ack && <span className="text-sm text-muted">Confirm what is not covered to continue.</span>}
          </div>
        </Panel>

        <Panel title="Policy">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-sm font-medium">Agent</p>
              <Select
                label="Agent"
                value={agent?.publicKey ?? ""}
                onValueChange={setAgentKey}
                options={agents.map((a) => ({ value: a.publicKey, label: a.label }))}
                className="mt-1.5 w-full"
              />
              <p className="mono mt-1.5 break-all text-sm text-muted">{agent?.publicKey}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Target on its allowed list</p>
              <Select label="Target" value={target} onValueChange={setTargetPick} options={targets.map((t) => ({ value: t, label: t }))} className="mt-1.5 w-full" />
            </div>
            <NumberField label="Coverage limit" suffix="NEAR" min={0} step={0.1} value={limitNear} onChange={setLimit} />
            <NumberField label="Duration" suffix="days" min={1} value={days} onChange={setDays} />
            <NumberField label="Payout ratio" suffix="%" min={1} value={ratioPct} onChange={setRatio} hint="The 80% default is an assumption of the pool's worked example." />
          </div>
        </Panel>

        <Panel title="Who you trust">
          <p className="max-w-[80ch] text-[15px] leading-[1.6]">
            Two parties: the <strong className="font-medium">attestor</strong> reports whether code changed and at which block, and is permanently a
            trust assumption. The <strong className="font-medium">arbiter</strong> resolves conflicting reports. Aruna runs both at this stage, in public.
          </p>
          <p className="mt-3 max-w-[80ch] text-sm text-muted">
            {watch ? (
              watch.attestor ? (
                <>
                  Assigned to <span className="mono">{target}</span>: <span className="mono">{watch.attestor}</span>, heartbeat{" "}
                  {watch.fresh ? "fresh" : "not fresh"}.
                </>
              ) : (
                <>
                  <span className="mono">{target}</span> has no attestor assigned.
                </>
              )
            ) : (
              "Reading the attestor assigned to this target."
            )}{" "}
            Recorded exposure is what passed through the vault, not the position&apos;s current value. The vault cannot read the target&apos;s state,
            and payouts use this figure.
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
