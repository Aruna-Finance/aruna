"use client";

import type { AgentView } from "@aruna/sdk";
import { useEffect, useMemo, useState } from "react";
import { nearToYocto } from "../fmt";
import { liveQuoteDeps, priceTargets, type TargetPrice } from "../quote-live";
import type { LiveVault } from "../useLiveVault";
import { Panel } from "./Panel";
import { PriceTable } from "./PriceTable";

const DEBOUNCE_MS = 400;
type Ok = Extract<LiveVault, { status: "ok" }>;
type Draft = { cap: number; maxClass: "immutable_verified" | "local_upgradeable" | "global_by_account" | "unknown"; targets: string[] };

/**
 * What the policy being edited would cost, from the pool. It asks again when the draft changes, after a short pause,
 * and ignores an answer that arrives after a newer question. The draft is never signed from here: the save button of
 * the policy form is the only way to apply it, and it goes through the transaction preview.
 */
export function PricePanel({ live, a, draft }: { live: Ok; a: AgentView; draft: Draft }) {
  const [rows, setRows] = useState<TargetPrice[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const near = a.policy.limits?.find((l) => l.token === "near");
  const currentCap = near ? BigInt(near.dailyCap) : 0n;
  const draftCap = Number.isFinite(draft.cap) && draft.cap > 0 ? nearToYocto(draft.cap) : 0n;
  const key = `${draft.cap}|${draft.maxClass}|${draft.targets.join(",")}|${a.publicKey}|${currentCap}`;
  const view = live.view;
  const targets = useMemo(() => draft.targets, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let current = true;
    setFailure(null);
    const t = setTimeout(() => {
      priceTargets(liveQuoteDeps(view), { vault: live.vault, agentPublicKey: a.publicKey, targets, currentCapYocto: currentCap, draftCapYocto: draftCap, draftMaxClass: draft.maxClass })
        .then((r) => current && setRows(r))
        .catch((e: unknown) => current && (setRows(null), setFailure(e instanceof Error ? e.message : "The pool could not be reached.")));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [key, view, live.vault, a.publicKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const assumptions = rows?.map((r) => (r.draft.ok ? r.draft.quote.assumptions.label : r.onChain.ok ? r.onChain.quote.assumptions.label : null)).find((x) => x) ?? null;

  return (
    <Panel title="What these limits cost" aside={<span className="text-sm text-muted">Testnet, assumed numbers</span>}>
      {failure ? (
        <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not get a price from the pool. {failure}</p>
      ) : rows === null ? (
        <p className="text-sm text-muted">Asking the pool.</p>
      ) : (
        <PriceTable rows={rows} assumptions={assumptions} />
      )}
    </Panel>
  );
}
