"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/shared/Button";
import { Select } from "@/shared/Select";
import { toast } from "@/shared/Toaster";
import { payoutOf } from "../data/claims";
import { claimsStore } from "../data/claims-mock";
import { dateUtc, n0 } from "../fmt";
import { useClaims } from "../useClaims";
import { useTargets } from "../useTargets";
import { ClaimPill, reportHref } from "../ui/ClaimPill";
import { Panel } from "../ui/Panel";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

export function Claims() {
  const { reports, claims } = useClaims();
  const { list } = useTargets();
  const [pick, setPick] = useState("dex.testnet");

  function simulate() {
    try {
      const r = claimsStore.reportDrift(pick);
      toast.success(`Report ${r.id} opened on ${pick}. The challenge window has started.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The registry refused the report.");
    }
  }

  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Reports and claims</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        Every drift report and every claim is public. A report freezes the target. A claim pays only if five conditions hold, and the
        formula is shown with it.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Drift reports">
          {reports.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className={th}>Report</th>
                    <th className={th}>Target</th>
                    <th className={th}>Attestor</th>
                    <th className={th}>Reported</th>
                    <th className={`${th} text-right`}>Claims</th>
                    <th className={th}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id}>
                      <td className={td}>
                        <Link href={reportHref(r.id)} className="mono underline underline-offset-4">
                          {r.id}
                        </Link>
                      </td>
                      <td className={`${td} mono`}>{r.target}</td>
                      <td className={`${td} mono`}>{r.attestor}</td>
                      <td className={`${td} text-sm whitespace-nowrap`}>{dateUtc(r.reportedAt)}</td>
                      <td className={`${td} mono text-right`}>{claims.filter((c) => c.report === r.id).length}</td>
                      <td className={td}>
                        <ClaimPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="max-w-[70ch] text-[15px] leading-[1.6]">
              No drift has been reported. Until an attestor reports one, no claim exists and every covered target is running the code it
              was classified with.
            </p>
          )}
        </Panel>

        {claims.length > 0 && (
          <Panel title="Claims">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className={th}>Agent</th>
                    <th className={th}>Target</th>
                    <th className={`${th} text-right`}>Recorded exposure</th>
                    <th className={`${th} text-right`}>Payout</th>
                    <th className={th}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => (
                    <tr key={c.id}>
                      <td className={`${td} mono`}>
                        <Link href={reportHref(c.report)} className="underline underline-offset-4">
                          {c.agent}
                        </Link>
                      </td>
                      <td className={`${td} mono`}>{c.target}</td>
                      <td className={`${td} mono text-right`}>{n0(c.exposure)} USDC</td>
                      <td className={`${td} mono text-right`}>
                        {n0(c.status === "paid" ? c.payout : payoutOf(c))} USDC
                        {c.status !== "paid" && c.status !== "rejected" && <span className="text-muted"> due</span>}
                      </td>
                      <td className={td}>
                        <ClaimPill status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        <Panel title="Simulate a drift report" aside={<span className="text-sm text-muted">Mock only</span>}>
          <p className="max-w-[70ch] text-sm leading-[1.6] text-slate">
            In the live system an attestor sends the report from the attestor console (a later phase). Here you can open one on a
            target, then follow it through the challenge window to a payout.
          </p>
          <div className="mt-5 flex flex-wrap items-end gap-4">
            <div className="min-w-60">
              <p className="text-sm font-medium">Target</p>
              <Select
                label="Target"
                value={pick}
                onValueChange={setPick}
                options={list.map((t) => ({ value: t.id, label: t.id }))}
                className="mt-1.5 w-full"
              />
            </div>
            <Button type="button" onClick={simulate}>
              Open a report
            </Button>
          </div>
        </Panel>
      </div>
    </article>
  );
}
