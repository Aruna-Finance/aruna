"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/shared/Button";
import { toast } from "@/shared/Toaster";
import { curlFor, isSafeAccountId } from "@/landing/lib/verify-commands";
import type { RiskClass } from "@/landing/lib/classifier-types";
import { yoctoToNear } from "../fmt";
import { useVaultView } from "../useVaultView";
import { ClassTag } from "../ui/ClassTag";
import { CopyBlock } from "../ui/CopyBlock";
import { Panel } from "../ui/Panel";

const RISK = new Set(["immutable_verified", "local_upgradeable", "global_by_account", "unknown"]);

export function PublicAgent() {
  const params = useSearchParams();
  const vault = params.get("vault") ?? "";
  const key = params.get("key") ?? "";
  const state = useVaultView(isSafeAccountId(vault) ? vault : "");

  const crumb = (
    <p className="text-sm text-muted">
      <Link href={`/console/lookup/?vault=${encodeURIComponent(vault)}`} className="underline underline-offset-4">
        Look up
      </Link>{" "}
      / Public agent page
    </p>
  );

  if (state.status === "idle" || state.status === "loading") {
    return (
      <p className="text-muted" role="status">
        Reading the agent from the network.
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <article>
        {crumb}
        <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">Could not read this vault</h1>
        <p className="mt-4 max-w-[70ch] text-slate">
          <span className="mono">{vault}</span>: {state.message}.
        </p>
      </article>
    );
  }

  const view = state.view;
  const a = view.agents.find((x) => x.publicKey === key);
  if (!a) {
    return (
      <article>
        {crumb}
        <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">Agent not found</h1>
        <p className="mt-4 max-w-[70ch] text-slate">
          No agent with key <span className="mono break-all">{key}</span> is registered on <span className="mono">{view.vault}</span>.
        </p>
      </article>
    );
  }

  const fcKeys = view.agents.filter((x) => x.key).length;
  const warn = a.status !== "Active" || a.autoDisabled;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied.");
    } catch {
      toast.error("The browser blocked copying. Copy the address bar instead.");
    }
  }

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          {crumb}
          <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">{a.label}</h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className={warn ? "text-dawn-ink" : ""}>{a.autoDisabled ? "Stopped by vault" : a.status}</span>
            <span className="mono text-muted break-all">{a.publicKey}</span>
            <span className="text-muted">on</span>
            <span className="mono">{view.vault}</span>
            <span className="text-muted">No login needed</span>
          </p>
        </div>
        <Button type="button" variant="outline" onClick={copyLink}>
          Copy this page&apos;s link
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="What this agent cannot do" aside={<span className="text-sm text-muted">The NEAR protocol refuses these</span>}>
          <ul className="grid gap-2 text-[15px]">
            {a.cannot.map((c) => (
              <li key={c} className="flex gap-3 border-t border-line pt-2">
                <span aria-hidden className="mt-2 size-2 shrink-0 bg-dawn-ink" />
                {c}
              </li>
            ))}
          </ul>
          {a.key && (
            <p className="mt-4 text-sm text-muted">
              Key receiver <span className="mono">{a.key.receiver}</span>, allowance{" "}
              <span className="mono">{a.key.allowance ? `${yoctoToNear(a.key.allowance)} NEAR` : "unlimited"}</span>.
            </p>
          )}
        </Panel>

        <Panel title="Verify it yourself">
          <p className="mb-4 max-w-[80ch] text-sm leading-[1.6] text-slate">
            One call shows every agent on this vault with its exact permission. Expect {fcKeys} function-call {fcKeys === 1 ? "key" : "keys"},
            receiver <span className="mono">{view.vault}</span>, and no full-access key. This read found{" "}
            <span className="mono">{view.fullAccessKeys}</span> full-access {view.fullAccessKeys === 1 ? "key" : "keys"}.
          </p>
          <CopyBlock text={curlFor("view_access_key_list", view.vault, "testnet")} />
        </Panel>

        <Panel title="Economic limits" aside={<span className="text-sm text-muted">The vault enforces these on-chain</span>}>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted">Per transaction</dt>
              <dd className="mono">{yoctoToNear(a.policy.maxPerTx)} NEAR</dd>
            </div>
            <div>
              <dt className="text-muted">Per day</dt>
              <dd className="mono">{yoctoToNear(a.policy.dailyCap)} NEAR</dd>
            </div>
            <div>
              <dt className="text-muted">Max slippage</dt>
              <dd className="mono">{(a.policy.maxSlippageBps / 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt className="text-muted">Riskiest class</dt>
              <dd>
                {RISK.has(a.policy.maxRiskClass) ? <ClassTag c={a.policy.maxRiskClass as RiskClass} /> : <span className="mono">{a.policy.maxRiskClass}</span>}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted">Allowed contracts</dt>
              <dd className="mono break-all">{a.policy.allowedTargets.join(", ") || "None"}</dd>
            </div>
            {a.usage && (
              <>
                <div>
                  <dt className="text-muted">Spent today</dt>
                  <dd className="mono">{yoctoToNear(a.usage.spentToday)} NEAR</dd>
                </div>
                <div>
                  <dt className="text-muted">Reserved</dt>
                  <dd className="mono">{yoctoToNear(a.usage.reserved)} NEAR</dd>
                </div>
              </>
            )}
          </dl>
        </Panel>

        <Panel title="Who controls the money">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Owner</dt>
              <dd className="mono break-all">{view.owner}</dd>
            </div>
            <div>
              <dt className="text-muted">Operator</dt>
              <dd className="mono break-all">{view.operator ?? "None"}</dd>
            </div>
          </dl>
          <p className="mt-4 max-w-[80ch] text-sm leading-[1.6] text-slate">
            The owner holds the funds. An operator can run agents within the owner&apos;s ceiling, and cannot:
          </p>
          <ul className="mt-2 grid gap-1 text-sm text-slate">
            {view.operatorCannot.map((c) => (
              <li key={c}>- {c}</li>
            ))}
          </ul>
        </Panel>

        <Panel title="Sent through vault" aside={<span className="text-sm text-muted">Not the current value of any position</span>}>
          {view.exposure && view.exposure.length ? (
            <ul className="grid gap-2 text-[15px]">
              {view.exposure.map((e) => (
                <li key={e.target} className="flex flex-wrap justify-between gap-x-4 border-t border-line pt-2">
                  <span className="mono break-all">{e.target}</span>
                  <span className="mono">
                    {yoctoToNear(e.amount)} NEAR <span className="text-muted">({e.classAtRecord} when recorded)</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              {view.exposure ? "Nothing has been sent through this vault yet." : "This vault version does not report exposure."}
            </p>
          )}
        </Panel>

        <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px] leading-[1.6]">
          These facts bound what the agent can do. They do not say its decisions are good or that every target is safe.
        </p>
      </div>
    </article>
  );
}
