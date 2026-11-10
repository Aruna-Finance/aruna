"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { CodeRef } from "@/landing/lib/classifier-types";
import { curlFor } from "@/landing/lib/verify-commands";
import { CLAIMS_ASSUME } from "../data/claims";
import { attestorStore } from "../data/attestor";
import { channelsOf } from "../data/channels";
import { mockTargets } from "../data/mock";
import type { TargetRecord } from "../data/types";
import { BASIS, CLASS_INFO } from "../classInfo";
import { block as blk, n0 } from "../fmt";
import { useVault } from "../useVault";
import { agentHref } from "../ui/AgentsTable";
import { ClassTag } from "../ui/ClassTag";
import { CopyBlock } from "../ui/CopyBlock";
import { Freshness } from "../ui/Freshness";
import { Panel } from "../ui/Panel";
import { attestorFor } from "../data/coverage-mock";

const short = (h: string | null | undefined) => (h ? (h.length > 16 ? `${h.slice(0, 8)}...${h.slice(-4)}` : h) : "none");

function refText(r: CodeRef | null): string {
  if (!r) return "none";
  if (r.kind === "local") return `local: ${short(r.codeHash)}`;
  if (r.kind === "global_hash") return `global_hash: ${short(r.globalHash)}`;
  return `global_account: ${r.ownerAccount}`;
}

/** What the three public reads found, written from the stored evidence only. */
function stepsOf(t: TargetRecord) {
  const ev = t.classification.evidence;
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
      verdict: t.classification.class,
    },
  ] as const;
}

export function TargetDetail() {
  const id = useSearchParams().get("id") ?? "";
  const vault = useVault();
  const [target, setTarget] = useState<TargetRecord | null | undefined>(undefined);
  const [now, setNow] = useState(0);
  const { pending } = useSyncExternalStore(attestorStore.subscribe, attestorStore.get, attestorStore.get);

  useEffect(() => {
    let live = true;
    Promise.all([mockTargets.get(id), mockTargets.currentBlock()]).then(([t, b]) => {
      if (live) {
        setTarget(t);
        setNow(b);
      }
    });
    return () => {
      live = false;
    };
  }, [id]);

  const crumb = (
    <p className="text-sm text-muted">
      <Link href="/console/targets/" className="underline underline-offset-4">
        Targets
      </Link>{" "}
      / {id ? <span className="mono">{id}</span> : "Target"}
    </p>
  );

  if (target === undefined) return <p className="text-muted">Loading the target.</p>;
  if (target === null) {
    return (
      <article>
        {crumb}
        <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">Target not found</h1>
        <p className="mt-4 max-w-[70ch] text-slate">
          {id ? <span className="mono">{id}</span> : "That target"} has not been classified. Classify it from the Targets page.
        </p>
      </article>
    );
  }

  const cls = target.classification.class;
  const ev = target.classification.evidence;
  const agents = vault.agents.filter((a) => (a.exposure[target.id] ?? 0) > 0);
  const channels = channelsOf(target, pending.find((d) => d.target === target.id)?.channel ?? null);
  const owner = ev.codeRef?.kind === "global_account" ? ev.codeRef.ownerAccount : null;
  const age = now - target.fetchedAtBlock;

  return (
    <article>
      {crumb}
      <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">{target.label}</h1>
      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
        <ClassTag c={cls} />
        {target.frozen && <span className="text-sm text-dawn-ink">Frozen by a drift report</span>}
        <span className="text-sm text-muted">
          {BASIS[ev.mutabilityBasis]}. {CLASS_INFO[cls].premium}.
        </span>
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="How this class was reached">
          <ol className="grid gap-0">
            {stepsOf(target).map((s) => (
              <li key={s.rpc} className="grid grid-cols-[1.25rem_1fr] gap-x-4 border-t border-line py-3 first:border-t-0 first:pt-0">
                <i aria-hidden className={`mt-1.5 block size-2.5 ${cls === "unknown" && s.rpc === "view_code" ? "bg-dawn-ink" : "bg-ink"}`} />
                <div>
                  <p className="mono text-sm">{s.rpc}</p>
                  <p className="mt-1 max-w-[80ch] text-sm leading-[1.6] text-slate">{s.finding}</p>
                  {"verdict" in s && (
                    <p className="mt-2">
                      <ClassTag c={s.verdict} />
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        {owner && (
          <Panel title="Why hash monitors miss this target">
            <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
              When <span className="mono">{owner}</span> redeploys, no transaction touches this account, so a monitor that watches
              this account never sees it.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className="border-b border-line-2 px-3 py-2 text-left font-medium whitespace-nowrap">Field</th>
                    <th className="border-b border-line-2 px-3 py-2 text-left font-medium whitespace-nowrap">Before</th>
                    <th className="border-b border-line-2 px-3 py-2 text-left font-medium whitespace-nowrap">After a redeploy</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["view_account.code_hash", "1111...1111", "1111...1111, unchanged"],
                    ["view_code.hash", "73ETF...", "J2gKR..., changed"],
                    ["version()", "v1", "v2, active 3 blocks later"],
                  ].map(([f, a, b]) => (
                    <tr key={f}>
                      <td className="mono border-b border-line px-3 py-3">{f}</td>
                      <td className="mono border-b border-line px-3 py-3">{a}</td>
                      <td className="mono border-b border-line px-3 py-3">{b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-muted">Lab result on a single-shard sandbox.</p>
          </Panel>
        )}

        <Panel title="Check it yourself">
          <div className="grid gap-3">
            <CopyBlock text={curlFor("view_account", target.id, "testnet")} />
            <CopyBlock text={curlFor("view_access_key_list", target.id, "testnet")} />
            <CopyBlock text={curlFor("view_code", target.id, "testnet")} />
          </div>
        </Panel>

        <Panel title="Stored evidence">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["Basis", ev.mutabilityBasis],
                ["Checked at block", blk(ev.checkedAtBlock)],
                ["Assigned attestor", attestorFor(target.id)],
                ["Code reference", refText(ev.codeRef)],
                ["Full-access keys", String(ev.fullAccessKeyCount)],
                ["Function-call keys", String(ev.functionCallKeyCount)],
                ["Resolved code hash", short(ev.resolvedCodeHash)],
                ["Upgrade imports", ev.upgradeImports.join(", ") || "None found"],
                ["WASM parsed", ev.wasmParsed ? "Yes" : "No"],
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
                <Freshness age={age} />
              </dd>
            </div>
          </dl>
          {ev.upgradeImports.length > 0 && (
            <p className="mt-4 max-w-[80ch] text-sm text-muted">
              Presence does not prove a reachable path. near-sdk&apos;s Promise may link these on its own.
            </p>
          )}
          <p className="mt-4 max-w-[80ch] text-sm text-muted">
            {cls === "immutable_verified"
              ? "Means no detected upgrade path under the checks listed. Permanent caching waits on T9."
              : "Rechecked regularly, because this class can change."}
          </p>
        </Panel>

        <Panel title="Drift channels" aside={<span className="text-sm text-muted">Poll interval {CLAIMS_ASSUME.pollIntervalSec} seconds (assumption)</span>}>
          <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
            All four are needed. The last one is the one a hash monitor cannot see.
          </p>
          <ul className="mt-4 grid gap-2 text-[15px]">
            {channels.map((c) => (
              <li key={c.key} className="flex gap-3 border-t border-line pt-2">
                <i
                  aria-hidden
                  className={`mt-2 block size-2 shrink-0 ${c.state === "changed" ? "bg-dawn-ink" : c.state === "clear" ? "bg-ink" : "border border-line-2"}`}
                />
                <span>
                  {c.name} <span className="text-muted">- {c.state}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Your agents on this target">
          {agents.length ? (
            <ul className="grid gap-2 text-[15px]">
              {agents.map((a) => (
                <li key={a.id} className="flex justify-between gap-4 border-t border-line pt-2">
                  <Link href={agentHref(a.id)} className="mono underline underline-offset-4">
                    {a.id}
                  </Link>
                  <span className="mono">{n0(a.exposure[target.id])} USDC</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">None.</p>
          )}
        </Panel>
      </div>
    </article>
  );
}
