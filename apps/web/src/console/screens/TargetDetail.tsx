"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Classification, CodeRef } from "@/landing/lib/classifier-types";
import { curlFor } from "@/landing/lib/verify-commands";
import { BASIS, CLASS_INFO } from "../classInfo";
import { block as blk } from "../fmt";
import { AGREEMENT_TEXT, CODE_CHANGE_TEXT, agreement, codeChange, freshnessOf, type RegistryTarget } from "../data/registry-live";
import { REGISTRY } from "../data/price";
import { STATE_TEXT } from "../data/report-live";
import { useRegistryTarget, type RegistryTargetView } from "../useRegistryTargets";
import { ClassTag } from "../ui/ClassTag";
import { CopyBlock } from "../ui/CopyBlock";
import { Freshness } from "../ui/Freshness";
import { Panel } from "../ui/Panel";

const short = (h: string | null | undefined) => (h ? (h.length > 16 ? `${h.slice(0, 8)}...${h.slice(-4)}` : h) : "none");

function refText(r: CodeRef | null): string {
  if (!r) return "none";
  if (r.kind === "local") return `local: ${short(r.codeHash)}`;
  if (r.kind === "global_hash") return `global_hash: ${short(r.globalHash)}`;
  return `global_account: ${r.ownerAccount}`;
}

/** What the three public reads found, written from the evidence the engine returned. */
function stepsOf(c: Classification) {
  const ev = c.evidence;
  return [
    {
      rpc: "view_account",
      finding:
        ev.codeRef?.kind === "local"
          ? `The account holds its own code, hash ${short(ev.codeRef.codeHash)}.`
          : ev.codeRef
            ? "The code hash is the zero hash, so the code is a global contract referenced by this account."
            : "The account holds no code that could be read.",
    },
    {
      rpc: "view_access_key_list",
      finding: `${ev.fullAccessKeyCount} full-access ${ev.fullAccessKeyCount === 1 ? "key" : "keys"} and ${ev.functionCallKeyCount} function-call ${ev.functionCallKeyCount === 1 ? "key" : "keys"}.${ev.fullAccessKeyCount ? " A full-access key can deploy new code." : ""}`,
    },
    {
      rpc: "view_code",
      finding: ev.wasmParsed
        ? ev.upgradeImports.length
          ? `The code parses. It imports ${ev.upgradeImports.join(", ")}.`
          : "The code parses and none of the scanned upgrade imports are present."
        : "The code could not be parsed, so its imports are not known.",
    },
  ] as const;
}

export function TargetDetail() {
  const id = (useSearchParams().get("id") ?? "").trim();
  return <TargetView id={id} data={useRegistryTarget(id)} />;
}

export function TargetView({ id, data }: { id: string; data: RegistryTargetView }) {
  const crumb = (
    <p className="text-sm text-muted">
      <Link href="/console/targets/" className="underline underline-offset-4">
        Targets
      </Link>{" "}
      / {id ? <span className="mono">{id}</span> : "Target"}
    </p>
  );
  if (!id) {
    return (
      <article>
        {crumb}
        <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">No target named</h1>
        <p className="mt-4 max-w-[70ch] text-slate">Open a target from the Targets page.</p>
      </article>
    );
  }
  if (data.state === "loading")
    return (
      <article>
        {crumb}
        <p className="mt-4 text-muted">Reading the registry and running the classifier.</p>
      </article>
    );
  if (data.state === "error")
    return (
      <article>
        {crumb}
        <p className="mt-4 border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not read the registry. {data.message}</p>
      </article>
    );
  return <Detail id={id} t={data.target} head={data.head} live={data.live} liveProblem={data.liveProblem} crumb={crumb} />;
}

function Detail({ id, t, head, live, liveProblem, crumb }: { id: string; t: RegistryTarget; head: number; live: Classification | null; liveProblem: string | null; crumb: React.ReactNode }) {
  const rec = t.record;
  const verdict = agreement(rec?.class ?? null, live?.class ?? null);
  const code = codeChange(rec?.resolved_code_hash, live?.evidence.resolvedCodeHash);
  const owner = live?.evidence.codeRef?.kind === "global_account" ? live.evidence.codeRef.ownerAccount : null;
  return (
    <article>
      {crumb}
      <h1 className="mt-3 break-all text-[clamp(28px,4vw,44px)]">{id}</h1>
      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
        {rec ? <ClassTag c={rec.class} /> : <span className="mono text-sm text-muted">not recorded</span>}
        {rec?.frozen && <span className="text-sm text-dawn-ink">Frozen by a drift report</span>}
        <span className="text-sm text-muted">Read at block {blk(head)}.</span>
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Recorded in the registry">
          {rec ? (
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["Class", rec.class],
                  ["Recorded at block", blk(rec.classified_at_block)],
                  ["Recorded by", rec.classifier],
                  ["Evidence hash", rec.evidence_hash],
                  ["Resolved code hash", rec.resolved_code_hash ?? "none: this target cannot be covered"],
                  ["Upgrade authority", rec.upgrade_authority ?? "none recorded"],
                  ["Assigned attestor", t.attestor ?? "none"],
                  ["Attestor heartbeat", t.attestor ? (t.heartbeatFresh ? "fresh" : "stale") : "-"],
                ] as const
              ).map(([l, v]) => (
                <div key={l}>
                  <dt className="text-muted">{l}</dt>
                  <dd className="mono break-all">{v}</dd>
                </div>
              ))}
              <div>
                <dt className="text-muted">Vault cache</dt>
                <dd className="mt-1">
                  <Freshness age={freshnessOf(rec, head).age} />
                </dd>
              </div>
            </dl>
          ) : (
            <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">{AGREEMENT_TEXT.not_recorded}</p>
          )}
        </Panel>

        <Panel title="A fresh run of the classifier" aside={<span className="text-sm text-muted">@aruna/classifier-core, public testnet RPC</span>}>
          {live ? (
            <>
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <ClassTag c={live.class} />
                <span className="text-sm text-muted">
                  {BASIS[live.evidence.mutabilityBasis]}. {CLASS_INFO[live.class].premium}.
                </span>
              </p>
              <p className={`mt-3 max-w-[80ch] text-sm leading-[1.6] ${verdict === "differ" ? "text-dawn-ink" : "text-slate"}`}>{AGREEMENT_TEXT[verdict]}</p>
              {rec && <p className={`mt-2 max-w-[80ch] text-sm leading-[1.6] ${code === "changed" ? "text-dawn-ink" : "text-slate"}`}>{CODE_CHANGE_TEXT[code]}</p>}
              <ol className="mt-5 grid gap-0">
                {stepsOf(live).map((s) => (
                  <li key={s.rpc} className="grid grid-cols-[1.25rem_1fr] gap-x-4 border-t border-line py-3 first:border-t-0 first:pt-0">
                    <i aria-hidden className="mt-1.5 block size-2.5 bg-ink" />
                    <div>
                      <p className="mono text-sm">{s.rpc}</p>
                      <p className="mt-1 max-w-[80ch] text-sm leading-[1.6] text-slate">{s.finding}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ["Basis", live.evidence.mutabilityBasis],
                    ["Checked at block", blk(live.evidence.checkedAtBlock)],
                    ["Code reference", refText(live.evidence.codeRef)],
                    ["Resolved code hash", short(live.evidence.resolvedCodeHash)],
                    ["Upgrade imports", live.evidence.upgradeImports.join(", ") || "None found"],
                    ["WASM parsed", live.evidence.wasmParsed ? "Yes" : "No"],
                  ] as const
                ).map(([l, v]) => (
                  <div key={l}>
                    <dt className="text-muted">{l}</dt>
                    <dd className="mono break-all">{v}</dd>
                  </div>
                ))}
              </dl>
              {live.evidence.upgradeImports.length > 0 && (
                <p className="mt-4 max-w-[80ch] text-sm text-muted">Presence does not prove a reachable path. near-sdk&apos;s Promise may link these on its own.</p>
              )}
            </>
          ) : (
            <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">{liveProblem ?? AGREEMENT_TEXT.live_unavailable} The registry record above is unaffected.</p>
          )}
        </Panel>

        {owner && (
          <Panel title="Why hash monitors miss this target">
            <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
              When <span className="mono">{owner}</span> redeploys, no transaction touches this account, so a monitor that watches this account never sees it.
              The registry watches the global contract&apos;s owner through a separate channel.
            </p>
            <p className="mt-3 text-sm text-muted">Measured on a single-shard sandbox; the evidence is in the lab results.</p>
          </Panel>
        )}

        <Panel title="Latest drift report">
          {t.latest ? (
            <p className="text-[15px]">
              <Link href={`/console/claims/detail/?id=${t.latest.id}`} className="underline underline-offset-4">
                Report {t.latest.id}
              </Link>{" "}
              <span className="mono text-sm text-muted">{STATE_TEXT[t.latest.state] ?? t.latest.state}</span>, changed at block {blk(t.latest.changedAtBlock)}.
            </p>
          ) : (
            <p className="text-sm text-muted">No drift report has been made on this target.</p>
          )}
        </Panel>

        <Panel title="Check it yourself">
          <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">The registry&apos;s record (a view call, no key), and the three public reads the classifier makes:</p>
          <div className="mt-4 grid gap-3">
            <CopyBlock text={`node fixtures/tools.mjs view ${REGISTRY} get_class '{"target":"${id}"}'`} />
            <CopyBlock text={curlFor("view_account", id, "testnet")} />
            <CopyBlock text={curlFor("view_access_key_list", id, "testnet")} />
            <CopyBlock text={curlFor("view_code", id, "testnet")} />
          </div>
        </Panel>
      </div>
    </article>
  );
}
