"use client";

import Link from "next/link";
import { REGISTRY } from "../data/price";
import { HEARTBEAT_STALE_BLOCKS, STATE_TEXT, attestorState, groupByAttestor, heartbeatAge, type AttestorInfo } from "../data/attestor-live";
import { STATE_TEXT as REPORT_STATE } from "../data/report-live";
import { block, yoctoToNear } from "../fmt";
import { useAttestorsLive, type AttestorsLive } from "../useRegistryTargets";
import { ClassTag } from "../ui/ClassTag";
import { CopyBlock } from "../ui/CopyBlock";
import { targetHref } from "../ui/Freshness";
import { Panel } from "../ui/Panel";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

export function Attestor() {
  return <AttestorView data={useAttestorsLive()} />;
}

export function AttestorView({ data }: { data: AttestorsLive }) {
  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Attestors</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        The attestor must be trusted, permanently. Every route to detection with no outside party was tested and is closed. At the MVP the dispute arbiter
        is a second trust assumption. This page reads the registry; heartbeats and drift reports are sent from the attestor&apos;s own account, not from
        an owner&apos;s console.
      </p>

      {data.state === "loading" && (
        <p className="mt-8 text-muted" role="status">
          Reading the registry.
        </p>
      )}
      {data.state === "error" && <p className="mt-8 border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not read the registry. {data.message}</p>}
      {data.state === "ok" && <Body data={data} />}
    </article>
  );
}

function Body({ data }: { data: Extract<AttestorsLive, { state: "ok" }> }) {
  const { groups, unassigned } = groupByAttestor(data.rows);
  const info = new Map<string, AttestorInfo>(data.attestors.map((a) => [a.id, a]));
  return (
    <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
      {unassigned.length > 0 && (
        <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 leading-[1.6]">
          <strong className="font-medium">No attestor is assigned to {unassigned.map((t) => t.target).join(", ")}.</strong> The pool refuses coverage on a
          target without an attestor whose heartbeat is fresh.
        </p>
      )}

      {groups.length === 0 && <p className="text-muted">No listed target has an attestor assigned.</p>}
      {groups.map((g) => {
        const a = info.get(g.attestor)?.record ?? null;
        const state = attestorState(a, data.head);
        return (
          <Panel key={g.attestor} title={g.attestor} aside={<span className="text-sm text-muted">Read at block {block(data.head)}</span>}>
            <p className={`text-[15px] ${state === "alive" ? "" : "text-dawn-ink"}`}>{STATE_TEXT[state]}.</p>
            {a && (
              <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["Bond", `${yoctoToNear(a.bond)} NEAR`],
                    ["Last heartbeat", `${block(a.last_heartbeat)}, ${heartbeatAge(a, data.head).toLocaleString("en-US")} blocks ago (stale after ${HEARTBEAT_STALE_BLOCKS})`],
                    ["Registered at", block(a.registered_at)],
                    ["Signing key", a.signing_key],
                  ] as const
                ).map(([l, v]) => (
                  <div key={l}>
                    <dt className="text-muted">{l}</dt>
                    <dd className="mono break-all">{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            <h3 className="mt-6 text-base font-medium">Targets it watches</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className={th}>Target</th>
                    <th className={th}>Recorded class</th>
                    <th className={th}>Latest report</th>
                  </tr>
                </thead>
                <tbody>
                  {g.targets.map((t) => (
                    <tr key={t.target}>
                      <td className={td}>
                        <Link href={targetHref(t.target)} className="mono break-all underline underline-offset-4">
                          {t.target}
                        </Link>
                      </td>
                      <td className={td}>{t.record ? <ClassTag c={t.record.class} /> : <span className="text-sm text-muted">Not recorded</span>}</td>
                      <td className={`${td} text-sm`}>
                        {t.latest ? (
                          <>
                            <Link href={`/console/claims/detail/?id=${t.latest.id}`} className="underline underline-offset-4">
                              Report {t.latest.id}
                            </Link>{" "}
                            <span className="mono text-xs text-muted">{REPORT_STATE[t.latest.state] ?? t.latest.state}</span>
                            <span className="block text-xs text-muted">
                              {t.latest.attestor === g.attestor ? "made by this attestor" : `made by ${t.latest.attestor}`}, changed at {block(t.latest.changedAtBlock)}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted">None</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-5">
              <p className="mb-2 text-sm text-muted">The same record, without this page:</p>
              <CopyBlock text={`node fixtures/tools.mjs view ${REGISTRY} get_attestor '{"attestor":"${g.attestor}"}'`} />
            </div>
          </Panel>
        );
      })}

      <Panel title="What an attestor controls">
        <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
          An attestor reports whether a change happened and at which block. A contract cannot check a claim about a past block, so moving that block could
          decide who gets paid.
        </p>
        <ul className="mt-4 grid gap-2 text-sm">
          {["A bond that can be slashed", "A time sanity bound on the claimed block", "A challenge window before any payout", "A dispute, with an arbiter, on conflicting reports"].map((x) => (
            <li key={x} className="flex gap-3">
              <i aria-hidden className="mt-1.5 block size-2 shrink-0 bg-ink" />
              {x}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">These reduce the trust placed in an attestor. They do not remove it.</p>
      </Panel>
    </div>
  );
}
