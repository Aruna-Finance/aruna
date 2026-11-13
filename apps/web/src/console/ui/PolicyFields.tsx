"use client";

import type { RiskClass } from "@/landing/lib/classifier-types";
import { CLASS_RANK, type Policy } from "../data/vault";
import { CLASS_INFO, CLASS_ORDER } from "../classInfo";
import { ClassTag } from "./ClassTag";
import { NumberField } from "./Field";
import { TokenIcon } from "./Token";

/** A policy as the forms edit it: slippage in percent, targets as a plain list. */
export interface PolicyDraft {
  maxTx: number;
  cap: number;
  slipPct: number;
  maxClass: RiskClass;
  targets: string[];
}

export const draftFrom = (p: Policy): PolicyDraft => ({
  maxTx: p.maxPerTx,
  cap: p.dailyCap,
  slipPct: p.maxSlippageBps / 100,
  maxClass: p.maxRiskClass,
  targets: p.allowedTargets,
});

/** Targets above the riskiest class the policy allows drop out, because the vault would refuse them anyway. */
export function toPolicy(d: PolicyDraft, classOf: (t: string) => RiskClass | undefined): Policy {
  return {
    maxPerTx: d.maxTx,
    dailyCap: d.cap,
    maxSlippageBps: Math.round((d.slipPct || 0) * 100),
    maxRiskClass: d.maxClass,
    allowedTargets: d.targets.filter((t) => {
      const c = classOf(t);
      return c !== undefined && CLASS_RANK[c] <= CLASS_RANK[d.maxClass];
    }),
  };
}

export function LimitFields({ d, set }: { d: PolicyDraft; set: (d: PolicyDraft) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <NumberField label="Max per transaction" suffix={<TokenIcon t="USDC" />} min={1} value={d.maxTx} onChange={(v) => set({ ...d, maxTx: v })} />
      <NumberField label="Daily cap" suffix={<TokenIcon t="USDC" />} min={1} value={d.cap} onChange={(v) => set({ ...d, cap: v })} />
      <NumberField
        label="Max slippage"
        suffix="%"
        step={0.05}
        value={d.slipPct}
        onChange={(v) => set({ ...d, slipPct: v })}
        hint="Only as strong as the DEX's own min_amount_out. The vault has no price source."
      />
    </div>
  );
}

export function ClassPicker({ value, onChange }: { value: RiskClass; onChange: (c: RiskClass) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">Riskiest contracts the agent may use</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {CLASS_ORDER.map((c) => (
          <label key={c} className="flex cursor-pointer items-start gap-3 border border-line p-3 has-[:checked]:border-ink">
            <input type="radio" name="max-class" checked={value === c} onChange={() => onChange(c)} className="mt-1 accent-ink" />
            <span>
              <ClassTag c={c} />
              <span className="mt-1 block text-sm text-muted">
                {CLASS_INFO[c].basis} {CLASS_INFO[c].premium}.
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TargetPicker({
  targets,
  classes,
  d,
  set,
  frozen = [],
}: {
  targets: { id: string; label: string }[];
  classes: Record<string, RiskClass>;
  d: PolicyDraft;
  set: (d: PolicyDraft) => void;
  frozen?: string[];
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">Allowed contracts</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {targets.map((t) => {
          const c = classes[t.id];
          const off = c === undefined || CLASS_RANK[c] > CLASS_RANK[d.maxClass];
          const on = d.targets.includes(t.id) && !off;
          return (
            <label
              key={t.id}
              className={`flex items-start gap-3 border border-line p-3 has-[:checked]:border-ink ${off ? "opacity-60" : "cursor-pointer"}`}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={off}
                onChange={() => set({ ...d, targets: on ? d.targets.filter((x) => x !== t.id) : [...d.targets, t.id] })}
                className="mt-1 accent-ink"
              />
              <span>
                <span className="mono block text-sm">{t.id}</span>
                {c && <ClassTag c={c} />}
                {frozen.includes(t.id) && <span className="mono ml-2 text-xs text-dawn-ink">frozen</span>}
                <span className="mt-1 block text-sm text-muted">{off ? "Above the riskiest class you chose." : t.label}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
