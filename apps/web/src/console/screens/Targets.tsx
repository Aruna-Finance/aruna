"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/shared/Button";
import { Drawer } from "@/shared/Drawer";
import { toast } from "@/shared/Toaster";
import type { RiskClass } from "@/landing/lib/classifier-types";
import { mockTargets } from "../data/mock";
import { BASIS } from "../classInfo";
import { ClassTag } from "../ui/ClassTag";
import { Freshness, targetHref } from "../ui/Freshness";
import type { TargetPreset, TargetRecord } from "../data/types";

const INFO: Record<RiskClass, { title: string; certainty: string; premium: string }> = {
  immutable_verified: { title: "Immutable, proved", certainty: "No detected upgrade path", premium: "Lowest premium" },
  local_upgradeable: { title: "Local upgradeable", certainty: "Detected", premium: "Base premium" },
  global_by_account: { title: "Global by account", certainty: "Detected through a separate channel", premium: "Highest premium" },
  unknown: { title: "Unknown", certainty: "Not known", premium: "Cannot be covered" },
};

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

export function Targets() {
  const [rows, setRows] = useState<TargetRecord[] | null>(null);
  const [block, setBlock] = useState(0);
  const [presets, setPresets] = useState<TargetPreset[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([mockTargets.list(), mockTargets.currentBlock(), mockTargets.presets()]).then(([r, b, p]) => {
      if (live) {
        setRows(r);
        setBlock(b);
        setPresets(p);
        setPick(p[0]?.key ?? "");
      }
    });
    return () => {
      live = false;
    };
  }, []);

  async function run() {
    if (!pick) return;
    setBusy(true);
    try {
      const { record, added } = await mockTargets.classify(pick);
      setRows(await mockTargets.list());
      setPanel(false);
      const cls = record.classification.class;
      toast.success(added ? `${record.id} classified as ${cls}.` : `${record.id} is already listed as ${cls}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The classifier did not answer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-[clamp(28px,4vw,44px)]">Targets and their risk classes</h1>
          <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
            Three checks on public chain data decide each class. Anyone can repeat them and get the same answer. Only
            the registry&apos;s authorized classifier set records a class on chain. A vault checks the last recorded
            class, never a live read.
          </p>
        </div>
        <Button type="button" onClick={() => setPanel(true)}>
          Classify a new target
        </Button>
      </div>

      {rows === null ? (
        <p className="mt-8 text-muted" role="status">
          Loading targets.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-8 border border-line px-5 py-4 text-slate">
          No target has been classified yet. Classify one and it appears here once a classifier records it.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto border border-line-2 bg-paper p-6 md:p-8">
          <table className="w-full min-w-[760px] border-collapse text-[15px]">
            <thead>
              <tr>
                <th className={th}>Target</th>
                <th className={th}>Class</th>
                <th className={th}>Certainty</th>
                <th className={th}>Premium effect</th>
                <th className={`${th} text-right`}>Last recorded</th>
                <th className={`${th} text-right`}>Freshness</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const c = t.classification.class;
                return (
                  <tr key={t.id}>
                    <td className={td}>
                      <Link href={targetHref(t.id)} className="mono block underline-offset-4 hover:underline">
                        {t.id}
                      </Link>
                      <span className="text-sm text-muted">{t.label}</span>
                      {t.frozen && <span className="mono ml-2 text-xs text-dawn-ink">frozen</span>}
                    </td>
                    <td className={td}>
                      <ClassTag c={c} />
                      <span className="mt-1 block max-w-[34ch] text-sm text-muted">
                        {BASIS[t.classification.evidence.mutabilityBasis]}
                      </span>
                    </td>
                    <td className={`${td} text-sm`}>{INFO[c].certainty}</td>
                    <td className={`${td} text-sm`}>{INFO[c].premium}</td>
                    <td className={`${td} mono whitespace-nowrap text-right text-muted`}>
                      #{t.classifiedAtBlock.toLocaleString("en-US")}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <Freshness age={block - t.fetchedAtBlock} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={panel} onClose={() => setPanel(false)} title="Classify a new target">
        <p className="text-sm leading-[1.6] text-slate">
          The browser cannot reach RPC from this prototype, so pick a test case. The real classifier follows the same
          steps.
        </p>
        <fieldset className="mt-4 grid gap-2">
          <legend className="sr-only">Test case</legend>
          {presets.map((p) => (
            <label
              key={p.key}
              className="flex cursor-pointer items-start gap-3 border border-line p-3 has-[:checked]:border-ink"
            >
              <input
                type="radio"
                name="preset"
                value={p.key}
                checked={pick === p.key}
                onChange={() => setPick(p.key)}
                className="mt-1 accent-ink"
              />
              <span>
                <span className="mono block text-sm">{p.id}</span>
                <span className="text-sm text-muted">{p.title}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="button" className="mt-6" onClick={run} disabled={busy || !pick}>
          Run the classifier
        </Button>
      </Drawer>
    </article>
  );
}
