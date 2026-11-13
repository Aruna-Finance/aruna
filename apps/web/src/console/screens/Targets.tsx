"use client";

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
      <h1 className="text-[clamp(28px,4vw,44px)]">Targets and their risk classes</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Three checks on public chain data decide each class. Anyone can repeat them and get the same answer. Only the registry&apos;s authorized
        classifier set records a class on chain, and a vault checks the last recorded class, never a live read. This list is what the registry
        holds today for the seeded targets and every target the pool has covered.
      </p>

      {data.state === "loading" && (
        <p className="mt-8 text-muted" role="status">
          Reading the registry.
        </p>
      )}
      {data.state === "error" && <p className="mt-8 border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not read the registry. {data.message}</p>}
      {data.state === "ok" && (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
          <Panel title="Recorded in the registry" aside={<span className="text-sm text-muted">Read at block {block(data.head)}</span>}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className={th}>Target</th>
                    <th className={th}>Recorded class</th>
                    <th className={th}>Attestor</th>
                    <th className={th}>Latest drift report</th>
                    <th className={`${th} text-right`}>Recorded</th>
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

          <Panel title="Open another target">
            <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
              The registry has no list of its targets, so it cannot be browsed. Name one to see its record and a fresh run of the classifier beside it.
            </p>
            <div className="mt-4 max-w-xl">
              <TextField label="Target account" mono value={other} onChange={setOther} />
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
        {rec?.frozen && <span className="mono text-xs text-dawn-ink">frozen by a drift report</span>}
      </td>
      <td className={td}>{rec ? <ClassTag c={rec.class} /> : <span className="text-sm text-muted">Not recorded</span>}</td>
      <td className={`${td} text-sm`}>
        {t.attestor ? (
          <>
            <span className="mono break-all">{t.attestor}</span>
            <span className={`block text-xs ${t.heartbeatFresh ? "text-muted" : "text-dawn-ink"}`}>{t.heartbeatFresh ? "heartbeat fresh" : "heartbeat stale"}</span>
          </>
        ) : (
          <span className="text-muted">None assigned</span>
        )}
      </td>
      <td className={`${td} text-sm`}>
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
      <td className={`${td} whitespace-nowrap text-right`}>
        {rec ? (
          <>
            <span className="mono block text-muted">{block(rec.classified_at_block)}</span>
            <Freshness age={freshnessOf(rec, head).age} />
          </>
        ) : (
          <span className="text-muted">-</span>
        )}
      </td>
    </tr>
  );
}
