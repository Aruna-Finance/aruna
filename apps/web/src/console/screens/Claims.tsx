"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/shared/Button";
import { amountText } from "../data/coverage-live";
import { block, n0 } from "../fmt";
import { useClaimAction } from "../useClaimAction";
import { useLiveVault, type LiveVault } from "../useLiveVault";
import { useVaultClaims } from "../useVaultClaims";
import { NoVault } from "../ui/NoVault";
import { Panel } from "../ui/Panel";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

const reportLink = (id: number, vault: string) => `/console/claims/detail/?id=${id}&vault=${encodeURIComponent(vault)}`;

export function Claims() {
  const live = useLiveVault();
  if (live.status !== "ok") return <NoVault live={live} title="Reports and claims" />;
  return <LiveClaims live={live} />;
}

function LiveClaims({ live }: { live: Extract<LiveVault, { status: "ok" }> }) {
  const { vault } = live;
  const [tick, setTick] = useState(0);
  const data = useVaultClaims(vault, tick);
  const claim = useClaimAction(vault, () => setTick((t) => t + 1));

  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Reports and claims</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Every drift report and every claim is public. A report freezes the target. A claim pays only if the pool&apos;s conditions hold, and the formula
        is shown with it.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        {data.state === "loading" && <p className="text-sm text-muted">Reading the registry and the pool.</p>}
        {data.state === "error" && <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not read the reports and claims. {data.message}</p>}
        {data.state === "ok" && (
          <>
            <Panel title="Drift reports on your covered targets">
              {data.reports.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-[15px]">
                    <thead>
                      <tr>
                        <th className={th}>Report</th>
                        <th className={th}>Target</th>
                        <th className={th}>Attestor</th>
                        <th className={th}>Changed at</th>
                        <th className={th}>Reported at</th>
                        <th className={th}>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reports.map((r) => (
                        <tr key={r.id}>
                          <td className={`${td} mono`}>
                            <Link href={reportLink(r.id, vault)} className="underline underline-offset-4">
                              {r.id}
                            </Link>
                          </td>
                          <td className={`${td} mono break-all`}>{r.target}</td>
                          <td className={`${td} mono break-all`}>{r.attestor}</td>
                          <td className={`${td} mono`}>{block(r.changedAtBlock)}</td>
                          <td className={`${td} mono`}>{block(r.reportedAtBlock)}</td>
                          <td className={td}>
                            <span className="mono text-sm">{r.state}</span>
                            <span className="block text-xs text-muted">{r.channel}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="max-w-[70ch] text-[15px] leading-[1.6]">
                  No drift has been reported on the targets this vault holds coverage on. Until an attestor reports one, no claim exists.
                </p>
              )}
            </Panel>

            {data.startable.length > 0 && (
              <Panel title="Start a claim">
                <ul className="grid gap-3">
                  {data.startable.map((s) => (
                    <li key={`${s.coverageId}:${s.reportId}`} className="flex flex-wrap items-center gap-3 text-[15px]">
                      <span>
                        Coverage #{s.coverageId} on <span className="mono">{s.target}</span>, report {s.reportId}
                      </span>
                      <Button type="button" variant="outline" onClick={() => claim(s)}>
                        Start a claim
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 max-w-[80ch] text-sm text-muted">
                  The pool decides. A claim sent inside the challenge window is refused and recorded, so it is safe to try; it costs gas.
                </p>
              </Panel>
            )}

            <Panel title="Claims on this vault's coverage">
              {data.claims.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-[15px]">
                    <thead>
                      <tr>
                        <th className={th}>Coverage and report</th>
                        <th className={th}>Outcome</th>
                        <th className={`${th} text-right`}>Paid by the pool</th>
                        <th className={th}>How the formula reads</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.claims.map((c, i) => (
                        <tr key={`${c.coverageId}:${c.reportId}:${i}`}>
                          <td className={td}>
                            <span className="mono block">coverage #{c.coverageId}</span>
                            <span className="mono block text-sm text-muted">
                              <Link href={reportLink(c.reportId, vault)} className="underline underline-offset-4">
                                report {c.reportId}
                              </Link>
                              , at {block(c.block)}
                            </span>
                            <span className="mono block break-all text-xs text-muted">{c.target}</span>
                          </td>
                          <td className={`${td} text-sm`}>{c.outcome}</td>
                          <td className={`${td} mono text-right`}>{amountText(c.token, c.paid)}</td>
                          <td className={`${td} text-sm`}>
                            {c.exposureInWindow === null ? (
                              <span className="text-muted">Exposure for this claim was not read.</span>
                            ) : (
                              <>
                                <span className="mono block text-muted">
                                  exposure before the change {amountText(c.token, c.exposureUntilChange ?? "0")}, less before block {block(c.paidThroughBlock)} {amountText(c.token, c.exposureUntilStart ?? "0")}
                                </span>
                                <span className="mono block">min({amountText(c.token, c.exposureInWindow)} x {c.ratioBps / 100}%, {amountText(c.token, c.remainingBefore)})</span>
                                <span className="mono block text-muted">= {amountText(c.token, c.byFormula ?? "0")}</span>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="max-w-[70ch] text-[15px] leading-[1.6]">No claim has been made on this vault&apos;s coverage ({n0(data.coverages.length)} held).</p>
              )}
              <p className="mt-5 max-w-[80ch] text-sm text-muted">
                The pool pays <span className="mono">min(exposure recorded between the last paid change and this one x ratio, remaining limit)</span>. The right-hand column
                recomputes that from the terms shown, as a check; the number in the middle is what the pool paid.
              </p>
            </Panel>
          </>
        )}
      </div>
    </article>
  );
}
