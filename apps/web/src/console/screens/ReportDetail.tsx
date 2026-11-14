"use client";

import { PageHeader } from "../ui/PageHeader";
import { ReadError } from "@/shared/ReadError";
import { Disclosure } from "@/shared/Disclosure";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createTestnetReads } from "../chain-reads";
import { amountText } from "../data/coverage-live";
import { reportRow, type ReportRow, type StoredReport } from "../data/claims-live";
import { REGISTRY } from "../data/price";
import { CHALLENGE_WINDOW_BLOCKS, STATE_TEXT, timelineOf } from "../data/report-live";
import { block } from "../fmt";
import { useLiveVault } from "../useLiveVault";
import { useTokenMeta } from "../useTokenMeta";
import { useVaultClaims } from "../useVaultClaims";
import { CopyBlock } from "../ui/CopyBlock";
import { Panel } from "../ui/Panel";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";
const DOT: Record<string, string> = { done: "bg-ink", now: "bg-dawn", bad: "bg-dawn-ink", "": "border border-line-2" };

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "none" } | { state: "ok"; report: ReportRow; head: number };

export function ReportDetail() {
  const raw = useSearchParams().get("id") ?? "";
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const reads = useMemo(() => createTestnetReads(), []);
  const [out, setOut] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    if (id === null) return;
    let alive = true;
    setOut({ state: "loading" });
    Promise.all([reads.view<StoredReport | null>(REGISTRY, "get_report", { id }), reads.headBlock()])
      .then(([r, head]) => alive && setOut(r ? { state: "ok", report: reportRow(r), head } : { state: "none" }))
      .catch((e: unknown) => alive && setOut({ state: "error", message: e instanceof Error ? e.message : "The registry could not be read." }));
    return () => {
      alive = false;
    };
  }, [id, reads]);

  const crumb = (
    <p className="text-sm text-muted">
      <Link href="/console/claims/" className="underline underline-offset-4">
        Claims
      </Link>{" "}
      / Report
    </p>
  );

  if (id === null || out.state === "none") {
    return (
      <article>
        <PageHeader title="Report not found" lead={crumb}>
          {id === null
            ? "A report is named by the number the registry gave it. Open one from the Claims page."
            : `The registry has no report ${id}.`}
        </PageHeader>
      </article>
    );
  }
  if (out.state === "loading") {
    return (
      <article>
        {crumb}
        <p className="mt-4 text-muted">Reading the registry.</p>
      </article>
    );
  }
  if (out.state === "error") {
    return (
      <article>
        {crumb}
        <ReadError what="the report" detail={out.message} className="mt-4" />
      </article>
    );
  }
  return <Report r={out.report} head={out.head} crumb={crumb} />;
}

function Report({ r, head, crumb }: { r: ReportRow; head: number; crumb: React.ReactNode }) {
  const steps = timelineOf(r, head);
  const live = useLiveVault();
  return (
    <article>
      <PageHeader
        lead={crumb}
        title={
          <>
            Drift on <span className="mono text-[0.86em]">{r.target}</span>
          </>
        }
      >
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="mono text-sm">{STATE_TEXT[r.state] ?? r.state}</span>
          <span className="text-sm text-muted">
            Report {r.id}, made at block {block(r.reportedAtBlock)}. Read at block {block(head)}.
          </span>
        </span>
      </PageHeader>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Report timeline">
          <ol className="grid gap-0">
            {steps.map((s) => (
              <li key={s.name} className="grid grid-cols-[1.25rem_1fr] gap-x-4 border-t border-line py-3 first:border-t-0 first:pt-0">
                <i aria-hidden className={`mt-1.5 block size-2.5 ${DOT[s.state]}`} />
                <div>
                  <p className="mono text-sm">{s.name}</p>
                  <p className="mt-1 max-w-[80ch] text-sm leading-[1.6] text-slate">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="The report">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["Attestor", r.attestor],
                ["Channel", r.channel],
                ["Observed at", block(r.observedAtBlock)],
                ["Changed at", block(r.changedAtBlock)],
                ["Reported at", block(r.reportedAtBlock)],
                ["Nonce", String(r.nonce)],
                ["Resolved code hash before", r.beforeHash],
                ["Resolved code hash after", r.afterHash],
              ] as const
            ).map(([l, v]) => (
              <div key={l}>
                <dt className="text-muted">{l}</dt>
                <dd className="mono break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 max-w-[80ch] text-sm leading-[1.6] text-slate">
            The changed block is the attestor&apos;s claim. The registry only checks that it lies within the lookback of the block the report was made
            at. The block number decides whose coverage was active. The time bound limits backdating, and does not eliminate it. The attestor is a trust
            assumption of this system, and so is the arbiter who rules on a dispute.
          </p>
        </Panel>

        <Disclosure title="Verify without this page" className="border border-line-2 bg-paper p-5 [&>summary]:text-[15px]">
          <div className="mt-4">
          <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
            From a clone of the repository (testnet, a view call, no key):
          </p>
          <div className="mt-4">
            <CopyBlock text={`node fixtures/tools.mjs view ${REGISTRY} get_report '{"id":${r.id}}'`} />
          </div>
          <p className="mt-4 max-w-[80ch] text-sm leading-[1.6] text-muted">
            A conflicting report and the arbiter&apos;s ruling are sent from the attestor and arbiter accounts, not from an owner&apos;s console. The challenge
            window is {CHALLENGE_WINDOW_BLOCKS} blocks.
          </p>
          </div>
        </Disclosure>

        {live.status === "ok" && <ClaimsOnReport vault={live.vault} reportId={r.id} />}
      </div>
    </article>
  );
}

function ClaimsOnReport({ vault, reportId }: { vault: string; reportId: number }) {
  const data = useVaultClaims(vault);
  const meta = useTokenMeta(data.state === "ok" ? data.claims.map((c) => c.token) : []);
  return (
    <Panel title={`Claims on this report for ${vault}`}>
      {data.state === "loading" && <p className="text-sm text-muted">Reading the pool.</p>}
      {data.state === "error" && <ReadError what="the claims" detail={data.message} />}
      {data.state === "ok" &&
        (() => {
          const rows = data.claims.filter((c) => c.reportId === reportId);
          if (!rows.length) return <p className="text-sm text-muted">No claim has been made on this report for this vault&apos;s coverage.</p>;
          return (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className={th}>Coverage</th>
                    <th className={th}>Outcome</th>
                    <th className={`${th} text-right`}>Paid by the pool</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => (
                    <tr key={`${c.coverageId}:${i}`}>
                      <td className={`${td} mono`}>
                        #{c.coverageId}
                        <span className="block text-xs text-muted">at {block(c.block)}</span>
                      </td>
                      <td className={`${td} text-sm`}>{c.outcome}</td>
                      <td className={`${td} mono text-right`}>{amountText(c.token, c.paid, meta.get(c.token))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
    </Panel>
  );
}
