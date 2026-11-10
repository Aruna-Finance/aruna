"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/shared/Button";
import { Select } from "@/shared/Select";
import { toast } from "@/shared/Toaster";
import { curlFor } from "@/landing/lib/verify-commands";
import { CLAIMS_ASSUME, payoutOf, type Claim, type Report } from "../data/claims";
import { claimsStore, conditionsFor } from "../data/claims-mock";
import { COVERAGE_ASSUME } from "../data/coverage";
import { block, dateUtc, days, n0 } from "../fmt";
import { useTx } from "../TxContext";
import { useClaims } from "../useClaims";
import { ClaimPill } from "../ui/ClaimPill";
import { CopyBlock } from "../ui/CopyBlock";
import { TextField } from "../ui/Field";
import { Panel } from "../ui/Panel";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";
const short = (h: string) => `${h.slice(0, 6)}...${h.slice(-4)}`;
const left = (sec: number) => {
  if (sec <= 0) return "0 hours";
  return sec >= 86_400 ? `${(sec / 86_400).toFixed(1)} days` : `${Math.ceil(sec / 3600)} hours`;
};

type Step = { name: string; text: string; state: "done" | "now" | "bad" | "" };

function stepsOf(r: Report, claims: Claim[], now: number, arbiter: string, subscribed: number): Step[] {
  const open = r.status === "challenge_window";
  const disputed = r.status === "disputed";
  const rejected = r.status === "rejected";
  const paid = r.status === "paid";
  const out: Step[] = [
    { name: "drift_reported", text: `Reported by ${r.attestor} at block ${block(r.observedAtBlock)}. A bond of ${n0(r.bond)} USDC is locked.`, state: "done" },
    {
      name: "target_frozen",
      text: `The registry pushed the freeze for ${r.target} to ${subscribed} subscribed vaults. It is not atomic across vaults, and calls already in flight cannot be stopped.`,
      state: rejected ? "bad" : "done",
    },
    {
      name: "Challenge window",
      text: open
        ? `${left(r.endsAt - now)} left. A second bonded attestor may send a conflicting report.`
        : disputed
          ? "A conflicting report opened a dispute."
          : r.conflict
            ? "Closed by the arbiter's ruling."
            : "Closed with no conflicting report.",
      state: open ? "now" : disputed || rejected ? "bad" : "done",
    },
  ];
  if (r.conflict) {
    out.push({
      name: "Disputed",
      text: disputed
        ? `No payout until ${arbiter} rules. The arbiter is a second trust assumption.`
        : `${arbiter} ${r.ruling?.uphold ? "upheld" : "rejected"} the report.`,
      state: disputed ? "now" : r.ruling?.uphold ? "done" : "bad",
    });
  }
  out.push({
    name: rejected ? "claim_rejected" : "claim_approved",
    text: rejected ? "Bond slashed. Target unfrozen." : paid ? "Claims that meet all five conditions were approved." : "Waits for the window to close.",
    state: rejected ? "bad" : paid ? "done" : "",
  });
  if (!rejected) {
    out.push({
      name: "payout_executed",
      text: paid ? `${n0(claims.reduce((s, c) => s + c.payout, 0))} USDC paid from the pool.` : "Paid once approved.",
      state: paid ? "done" : "",
    });
  }
  return out;
}

export function ReportDetail() {
  const id = useSearchParams().get("id") ?? "";
  const st = useClaims();
  const { open: openTx } = useTx();
  const r = st.reports.find((x) => x.id === id);
  const others = st.attestors.filter((a) => a !== r?.attestor);
  const [attestor, setAttestor] = useState("");
  const [hash, setHash] = useState("");

  const crumb = (
    <p className="text-sm text-muted">
      <Link href="/console/claims/" className="underline underline-offset-4">
        Claims
      </Link>{" "}
      / Report
    </p>
  );

  if (!r) {
    return (
      <article>
        {crumb}
        <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">Report not found</h1>
        <p className="mt-4 max-w-[70ch] text-slate">No report has the id {id ? <span className="mono">{id}</span> : "you asked for"}.</p>
      </article>
    );
  }

  const report = r;
  const claims = st.claims.filter((c) => c.report === report.id);
  const open = report.status === "challenge_window";
  const disputed = report.status === "disputed";
  const chosen = others.includes(attestor) ? attestor : (others[0] ?? "");
  const timeline = stepsOf(report, claims, st.now, st.arbiter, st.subscribedVaults);

  function attempt(f: () => void, done: string) {
    try {
      f();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The registry refused the call.");
    }
  }

  function sendConflict() {
    if (!hash.trim()) {
      toast.error("Enter the code hash the second attestor read from view_code.");
      return;
    }
    openTx({
      title: "Send a conflicting report?",
      signer: chosen,
      receiver: "registry.aruna.testnet",
      actions: [`conflicting report on ${report.target}`],
      note: `This locks a ${n0(CLAIMS_ASSUME.attestorBond)} USDC bond and opens a dispute. The contract does not judge which report is right; the arbiter rules.`,
      okLabel: "Send the conflicting report",
      onOk: () => attempt(() => claimsStore.conflict(report.id, chosen, hash), "Dispute opened. No payout until the arbiter rules."),
    });
  }

  function rule(uphold: boolean) {
    openTx({
      title: uphold ? "Uphold this report?" : "Reject this report?",
      signer: st.arbiter,
      receiver: "registry.aruna.testnet",
      actions: [uphold ? "resolve dispute: report upheld" : "resolve dispute: report rejected"],
      note: uphold
        ? "Claims that meet all five conditions are approved and paid."
        : "Claims are rejected, the reporting attestor's bond is slashed, and the target is unfrozen.",
      danger: !uphold,
      okLabel: uphold ? "Uphold report" : "Reject report",
      onOk: () => attempt(() => claimsStore.rule(report.id, uphold), uphold ? "Report upheld." : "Report rejected and bond slashed."),
    });
  }

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          {crumb}
          <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">
            Drift on <span className="mono text-[0.86em]">{report.target}</span>
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
            <ClaimPill status={report.status} />
            <span className="text-sm text-muted">Reported {dateUtc(report.reportedAt)}</span>
          </p>
        </div>
        {open && (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              attempt(() => claimsStore.advance(COVERAGE_ASSUME.challengeWindowSec), `Skipped ${days(COVERAGE_ASSUME.challengeWindowSec)}. The window is closed.`)
            }
          >
            Skip the challenge window
          </Button>
        )}
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Claim timeline">
          <ol className="grid gap-0">
            {timeline.map((s) => (
              <li key={s.name} className="grid grid-cols-[1.25rem_1fr] gap-x-4 border-t border-line py-3 first:border-t-0 first:pt-0">
                <i
                  aria-hidden
                  className={`mt-1.5 block size-2.5 ${s.state === "done" ? "bg-ink" : s.state === "now" ? "bg-dawn" : s.state === "bad" ? "bg-dawn-ink" : "border border-line-2"}`}
                />
                <div>
                  <p className="mono text-sm">{s.name}</p>
                  <p className="mt-1 max-w-[80ch] text-sm leading-[1.6] text-slate">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        {claims.map((c) => {
          const conds = conditionsFor(c, report, claimsStore.policyOf(c), st.now);
          return (
            <Panel key={c.id} title={`Payout for ${c.agent}`} aside={<ClaimPill status={c.status} />}>
              <pre className="mono overflow-x-auto bg-wash p-4 text-[13px] leading-[1.7] whitespace-pre-wrap">
                {`min(recorded_exposure x payout_ratio, remaining_limit)\nmin(${n0(c.exposure)} x ${c.payoutBps / 100}%, ${n0(c.limit)})\n= ${n0(payoutOf(c))} USDC`}
              </pre>
              <ul className="mt-4 grid gap-1.5 text-sm">
                {conds.map((x) => (
                  <li key={x.id} className="flex gap-3">
                    <i
                      aria-hidden
                      className={`mt-1.5 block size-2 shrink-0 ${x.ok ? "bg-ink" : x.id === "challenge" && (open || disputed) ? "border border-line-2" : "bg-dawn-ink"}`}
                    />
                    {x.label}
                  </li>
                ))}
              </ul>
              {c.rejectReason && <p className="mt-3 text-sm text-dawn-ink">{c.rejectReason}</p>}
              <p className="mt-3 text-sm text-muted">
                This is the formula&apos;s output, from exposure recorded before the claimed block. It is not a measurement of actual loss.
              </p>
            </Panel>
          );
        })}

        <Panel title="All claims on this report">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th className={th}>Agent</th>
                  <th className={th}>Target</th>
                  <th className={`${th} text-right`}>Exposure</th>
                  <th className={`${th} text-right`}>Payout</th>
                  <th className={th}>State</th>
                </tr>
              </thead>
              <tbody>
                {claims.length ? (
                  claims.map((c) => (
                    <tr key={c.id}>
                      <td className={`${td} mono`}>{c.agent}</td>
                      <td className={`${td} mono`}>{c.target}</td>
                      <td className={`${td} mono text-right`}>{n0(c.exposure)}</td>
                      <td className={`${td} mono text-right`}>{n0(c.status === "paid" ? c.payout : payoutOf(c))}</td>
                      <td className={td}>
                        <ClaimPill status={c.status} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className={`${td} text-muted`}>
                      No coverage on this target.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="The report">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["Channel", report.channel],
                ["Observed at", block(report.observedAtBlock)],
                ["Changed at", block(report.changedAtBlock)],
                ["Resolved before", short(report.beforeResolvedHash)],
                ["Resolved after", short(report.afterResolvedHash)],
                ["Nonce", report.nonce],
              ] as const
            ).map(([l, v]) => (
              <div key={l}>
                <dt className="text-muted">{l}</dt>
                <dd className="mono break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 max-w-[80ch] text-sm leading-[1.6] text-slate">
            The changed block is the attestor&apos;s claim. The contract only checks it is within {n0(CLAIMS_ASSUME.maxLookbackBlocks)}{" "}
            blocks. The block number decides whose coverage was active. The time bound limits backdating, and does not eliminate it. A
            quorum of independent attestors is on the roadmap.
          </p>
        </Panel>

        {open && (
          <Panel title="Send a conflicting report">
            <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
              A contract cannot verify counter-evidence. A second bonded attestor can open a dispute, and the arbiter rules. Anyone can
              read <span className="mono">view_code</span> and alert one.
            </p>
            <div className="mt-5 grid gap-5">
              <CopyBlock text={curlFor("view_code", report.target, "testnet")} />
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium">Bonded attestor</p>
                  <Select
                    label="Bonded attestor"
                    value={chosen}
                    onValueChange={setAttestor}
                    options={others.map((a) => ({ value: a, label: a }))}
                    className="mt-1.5 w-full"
                  />
                </div>
                <TextField label="Code hash from view_code" value={hash} onChange={setHash} mono />
              </div>
              <div>
                <Button type="button" onClick={sendConflict}>
                  Send the conflicting report
                </Button>
              </div>
            </div>
          </Panel>
        )}

        {report.conflict && (
          <Panel title="Dispute" aside={disputed ? undefined : <ClaimPill status={report.status} />}>
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">Conflicting attestor</dt>
                <dd className="mono">{report.conflict.attestor}</dd>
              </div>
              <div>
                <dt className="text-muted">Its hash</dt>
                <dd className="mono break-all">{short(report.conflict.resolvedHash)}</dd>
              </div>
              <div>
                <dt className="text-muted">Arbiter</dt>
                <dd className="mono">{st.arbiter}</dd>
              </div>
            </dl>
            {disputed && (
              <>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button type="button" variant="outline" onClick={() => rule(true)}>
                    Uphold the report
                  </Button>
                  <Button type="button" variant="outline" onClick={() => rule(false)}>
                    Reject the report
                  </Button>
                </div>
                <p className="mt-3 text-sm text-muted">Shown as the arbiter would see it. This is a second trust assumption.</p>
              </>
            )}
          </Panel>
        )}
      </div>
    </article>
  );
}
