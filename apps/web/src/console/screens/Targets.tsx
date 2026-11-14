"use client";

import { STACK_ON_MOBILE } from "../ui/stack";
import { ReadError } from "@/shared/ReadError";
import Link from "next/link";
import { useState } from "react";
import { block } from "../fmt";
import { freshnessOf, targetIdProblem, type RegistryTarget } from "../data/registry-live";
import { STATE_TEXT } from "../data/report-live";
import { useRegistryTargets, type RegistryTargets } from "../useRegistryTargets";
import { ClassTag } from "../ui/ClassTag";
import { TextField } from "../ui/Field";
import { Freshness, targetHref } from "../ui/Freshness";
import { Panel } from "../ui/Panel";
import { PageHeader } from "../ui/PageHeader";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

export function Targets() {
  return <TargetsView data={useRegistryTargets()} />;
}

export function TargetsView({ data }: { data: RegistryTargets }) {
  const [other, setOther] = useState("");
  const problem = other.trim() === "" ? null : targetIdProblem(other);
  return (
    <article>
      <PageHeader title="Contracts">
        Contracts your agents may use, and whether their code can still change.{" "}
        <Link href="/console/attestor/" className="underline underline-offset-4">
          Who reports code changes
        </Link>
      </PageHeader>

      {data.state === "loading" && (
        <p className="mt-8 text-muted" role="status">
          Reading the registry.
        </p>
      )}
      {data.state === "error" && <ReadError what="the contract records" detail={data.message} className="mt-8" />}
      {data.state === "ok" && (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
          <Panel title="Checked contracts">
            <div className="overflow-x-auto">
              <table className={`w-full min-w-[820px] border-collapse text-[15px] ${STACK_ON_MOBILE}`}>
                <thead>
                  <tr>
                    <th className={th}>Contract</th>
                    <th className={th}>Risk</th>
                    <th className={th}>Reported by</th>
                    <th className={th}>Latest change report</th>
                    <th className={`${th} text-right`}>Last checked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((t) => (
                    <Row key={t.target} t={t} head={data.head} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Check another contract">
            <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
              Name a contract to see its recorded risk and a fresh check beside it.
            </p>
            <div className="mt-4 max-w-xl">
              <TextField label="Contract account" mono value={other} onChange={setOther} />
            </div>
            <p className="mt-3 text-sm">
              {other.trim() === "" ? (
                <span className="text-muted">Enter an account id.</span>
              ) : problem ? (
                <span className="text-dawn-ink">{problem}</span>
              ) : (
                <Link href={targetHref(other.trim())} className="mono underline underline-offset-4">
                  Open {other.trim()}
                </Link>
              )}
            </p>
          </Panel>
        </div>
      )}
    </article>
  );
}

function Row({ t, head }: { t: RegistryTarget; head: number }) {
  const rec = t.record;
  return (
    <tr>
      <td className={td}>
        <Link href={targetHref(t.target)} className="mono block break-all underline-offset-4 hover:underline">
          {t.target}
        </Link>
        {rec?.frozen && <span className="mono text-xs text-dawn-ink">frozen by a change report</span>}
      </td>
      <td data-label="Risk" className={td}>{rec ? <ClassTag c={rec.class} /> : <span className="text-sm text-muted">Not recorded</span>}</td>
      <td data-label="Reported by" className={`${td} text-sm`}>
        {t.attestor ? (
          <>
            <span className="mono break-all">{t.attestor}</span>
            <span className={`block text-xs ${t.heartbeatFresh ? "text-muted" : "text-dawn-ink"}`}>{t.heartbeatFresh ? "reporting normally" : "not reporting recently"}</span>
          </>
        ) : (
          <span className="text-muted">None assigned</span>
        )}
      </td>
      <td data-label="Latest change report" className={`${td} text-sm`}>
        {t.latest ? (
          <>
            <Link href={`/console/claims/detail/?id=${t.latest.id}`} className="underline underline-offset-4">
              Report {t.latest.id}
            </Link>
            <span className="mono block text-xs text-muted">{STATE_TEXT[t.latest.state] ?? t.latest.state}</span>
          </>
        ) : (
          <span className="text-muted">None</span>
        )}
      </td>
      <td data-label="Last checked" className={`${td} whitespace-nowrap text-right`}>
        {rec ? (
          <>
            <span className="sr-only">Recorded at block {block(rec.classified_at_block)}. </span>
            <Freshness age={freshnessOf(rec, head).age} />
          </>
        ) : (
          <span className="text-muted">-</span>
        )}
      </td>
    </tr>
  );
}
