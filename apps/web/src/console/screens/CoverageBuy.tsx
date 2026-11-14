"use client";

import { PageHeader } from "../ui/PageHeader";
import { ReadError } from "@/shared/ReadError";
import { classLabelOf } from "@/landing/lib/class-labels";
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
  if (live.status !== "ok") return <NoVault live={live} title="Buy coverage" />;
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
        <PageHeader title="The owner buys coverage" lead={<Crumb vault={vault} />}>
          Coverage is an owner action, never available to an operator or an agent key.
        </PageHeader>
      </article>
    );
  }

  function send() {
    if (!ready || !request || !quote?.ok || !agent) return;
    buy({
      request,
      maxPremiumYocto: quote.quote.premium,
      actions: [`Cover ${target} for ${agent.label}`, `Pays up to ${yoctoToNear(request.limit)} NEAR over ${days} days, at ${ratioPct}% of what was sent`],
    });
  }

  return (
    <article>
      <PageHeader title="Buy coverage" lead={<Crumb vault={vault} />}>
        Pick an agent and a contract, then a limit and a payout ratio. The price is the pool&apos;s own quote. Testnet, in NEAR.
      </PageHeader>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Premium" aside={<span className="text-sm text-muted">Testnet, assumed numbers</span>}>
          {!agent ? (
            <p className="text-sm text-muted">This vault has no agent that is not revoked, so there is nothing to cover.</p>
          ) : problem ? (
            <p className="text-sm text-muted">{problem}</p>
          ) : quoteFailed ? (
            <ReadError what="a price from the pool" detail={quoteFailed} />
          ) : !cell ? (
            <p className="text-sm text-muted">Asking the pool.</p>
          ) : cell.kind === "refused" ? (
            <div>
              <p className="text-[28px] leading-[1.1]">Not priced</p>
              <p className="mt-2 max-w-[70ch] text-sm text-muted" title={cell.detail}>
                {cell.text}
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              <p className="text-[28px] leading-[1.1]">
                {cell.premium}
                <small className="ml-1 text-base text-muted">NEAR</small>
              </p>
              <p className="text-sm text-muted">
                For a {days} day window, risk &ldquo;{cell.cls ? classLabelOf(cell.cls) : "not recorded"}&rdquo;. It can pay out up to {cell.reachable} NEAR, bounded by the agent&apos;s daily
                limit. The price uses an assumed chance of a code change, not a measured one.
              </p>
            </div>
          )}
          {watchFailed && <ReadError what="the attestor state" detail={watchFailed} className="mt-4" />}
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

        <Panel title="What to cover">
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
            </div>
            <div>
              <p className="text-sm font-medium">Contract</p>
              <Select label="Contract" value={target} onValueChange={setTargetPick} options={targets.map((t) => ({ value: t, label: t }))} className="mt-1.5 w-full" />
            </div>
            <NumberField label="Coverage limit" suffix="NEAR" min={0} step={0.1} value={limitNear} onChange={setLimit} />
            <NumberField label="Duration" suffix="days" min={1} value={days} onChange={setDays} />
            <NumberField label="Payout ratio" suffix="%" min={1} value={ratioPct} onChange={setRatio} hint="The share of what was sent that the pool pays back." />
          </div>
        </Panel>

        <Panel title="Who you trust">
          <p className="max-w-[80ch] text-[15px] leading-[1.6]">
            You rely on two parties. An <strong className="font-medium">attestor</strong> reports whether code changed and when; that trust
            cannot be removed. An <strong className="font-medium">arbiter</strong> settles conflicting reports. Aruna runs both on testnet.
          </p>
          <p className="mt-3 max-w-[80ch] text-sm text-muted">
            {watch ? (
              watch.attestor ? (
                <>
                  Attestor for <span className="mono">{target}</span>: <span className="mono">{watch.attestor}</span>,{" "}
                  {watch.fresh ? "reporting normally" : "not reporting recently"}.
                </>
              ) : (
                <>
                  <span className="mono">{target}</span> has no attestor assigned.
                </>
              )
            ) : (
              "Reading the attestor for this contract."
            )}{" "}
            Payouts use what your agents sent through the vault, not what a position is worth now.
          </p>
        </Panel>

        <Panel title="What this does not cover">
          <NotCovered />
          <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-ink" />
            <span>I understand the payout follows a code change, not my actual loss.</span>
          </label>
        </Panel>
      </div>
    </article>
  );
}
