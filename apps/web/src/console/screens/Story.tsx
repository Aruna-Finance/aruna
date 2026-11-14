"use client";

import { PageHeader } from "../ui/PageHeader";
import { useSyncExternalStore } from "react";
import { Button } from "@/shared/Button";
import { storyStore } from "../data/story";
import { n0 } from "../fmt";
import { useClaims } from "../useClaims";
import { useCoverage } from "../useCoverage";
import { useVault } from "../useVault";
import { Panel } from "../ui/Panel";

export function Story() {
  const st = useSyncExternalStore(storyStore.subscribe, storyStore.get, storyStore.get);
  const vault = useVault();
  const { poolCapital, policies } = useCoverage();
  const { claims, reports } = useClaims();
  const next = storyStore.nextIndex();
  const steps = storyStore.steps;
  const done = next === -1;

  const paid = claims.filter((c) => c.status === "paid").reduce((s, c) => s + c.payout, 0);
  const rebalancer = vault.agents.find((a) => a.id === "rebalancer");

  return (
    <article>
      <PageHeader
        title={`Guided demo in ${steps.length} steps`}
        actions={
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            Restart the demo
          </Button>
        }
      >
        A scripted walkthrough on mock data, from checking a contract to a paid claim and a rejected false report. Nothing here touches your
        vault. One step reads a real testnet vault, and says so.
      </PageHeader>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel>
          <ol className="grid gap-0">
            {steps.map((s, i) => {
              const result = st.done[s.id];
              const isNext = i === next;
              return (
                <li key={s.id} className="grid grid-cols-[2rem_1fr] gap-x-4 border-t border-line py-5 first:border-t-0 first:pt-0">
                  <b
                    className={`inline-flex size-7 items-center justify-center border text-xs ${
                      result ? "border-ink bg-ink text-paper" : isNext ? "border-ink" : "border-line-2 text-muted"
                    }`}
                  >
                    {i + 1}
                  </b>
                  <div>
                    <p className="font-medium">
                      {s.title}
                      {s.live && <span className="mono ml-3 border border-line-2 px-2 py-0.5 text-xs font-normal">live testnet read</span>}
                    </p>
                    <p className="mt-1 max-w-[80ch] text-sm leading-[1.6] text-slate">{s.text}</p>
                    {result && (
                      <p className="mt-2 max-w-[80ch] text-sm leading-[1.6]">
                        {result}
                      </p>
                    )}
                    {isNext && (
                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        <Button type="button" disabled={st.busy} onClick={() => storyStore.run(s.id)}>
                          {st.busy ? "Running" : s.button}
                        </Button>
                      </div>
                    )}
                    {isNext && st.error && <p className="mt-3 text-sm text-dawn-ink">{st.error}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>

        <Panel title="Demo state" aside={<span className="text-sm text-muted">Mock data</span>}>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <dt className="text-muted">Rebalancer exposure on dex</dt>
              <dd className="mono">{n0(rebalancer?.exposure["dex.testnet"] ?? 0)} USDC</dd>
            </div>
            <div>
              <dt className="text-muted">Pool capital</dt>
              <dd className="mono">{n0(poolCapital)} USDC</dd>
            </div>
            <div>
              <dt className="text-muted">Coverage bought</dt>
              <dd className="mono">{policies.length}</dd>
            </div>
            <div>
              <dt className="text-muted">Change reports</dt>
              <dd className="mono">{reports.length}</dd>
            </div>
            <div>
              <dt className="text-muted">Claims paid</dt>
              <dd className="mono">{n0(paid)} USDC</dd>
            </div>
          </dl>
          {done && (
            <p className="mt-5 text-sm leading-[1.6]">
              The demo is complete. To do the same on testnet, create a vault from the console.
            </p>
          )}
          <p className="mt-5 max-w-[80ch] text-sm text-muted">
            Restarting reloads the page, because the mock state lives in memory.
          </p>
        </Panel>
      </div>
    </article>
  );
}
