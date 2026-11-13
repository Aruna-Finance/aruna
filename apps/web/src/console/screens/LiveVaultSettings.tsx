"use client";

import { classLabelOf } from "@/landing/lib/class-labels";
import { isValidAccountId } from "@aruna/rpc";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { availability, type ActorRole } from "../agent-actions";
import { createTestnetReads } from "../chain-reads";
import { yoctoToNum } from "../data/agent-draft";
import { ceilingEditProblem, ceilingToRaw } from "../data/ceiling";
import { classifiedTarget, classifiedTargets, readFactory, type TargetOption } from "../data/factory";
import { yoctoToNear } from "../fmt";
import { useLiveActions } from "../useLiveActions";
import type { LiveVault } from "../useLiveVault";
import { ClassTag } from "../ui/ClassTag";
import { NumberField, TextField } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { TokenIcon } from "../ui/Token";

type Ok = Extract<LiveVault, { status: "ok" }>;

/** Owner-only vault settings: who the operator is, and the ceiling every agent lives under. */
export function LiveVaultSettings({ live, actor, blockedReason }: { live: Ok; actor: ActorRole | null; blockedReason: string }) {
  const acts = useLiveActions(live.vault, live.refresh);
  const op = actor ? availability(actor, "set_operator") : ({ enabled: false, reason: blockedReason } as const);
  const ce = actor ? availability(actor, "set_ceiling") : ({ enabled: false, reason: blockedReason } as const);
  return (
    <>
      <OperatorPanel live={live} v={op} onSet={(next) => acts.setOperator(next, live.view.operator)} />
      <CeilingPanel live={live} v={ce} onSave={acts.setCeiling} />
    </>
  );
}

function OperatorPanel({ live, v, onSet }: { live: Ok; v: ReturnType<typeof availability>; onSet: (next: string | null) => void }) {
  const current = live.view.operator;
  const [next, setNext] = useState("");
  const id = next.trim();
  const bad = id !== "" && !isValidAccountId(id) ? "That is not a valid account id." : id !== "" && id === current ? "That account is already the operator." : null;
  return (
    <Panel className="mt-6" title="Operator">
      <p className="text-[15px]">
        Current operator: <span className="mono break-all">{current ?? "none"}</span>
      </p>
      <p className="mt-2 max-w-[70ch] text-sm leading-[1.6] text-muted">
        The operator can add agents, tighten their policies and pause or revoke them. It cannot loosen limits, resume an agent or withdraw.
      </p>
      <div className="mt-5 grid gap-4 sm:max-w-xl">
        <TextField label="New operator account" mono value={next} onChange={setNext} hint={bad ?? undefined} />
        <div className="flex flex-wrap items-start gap-3">
          <Button type="button" disabled={!v.enabled || id === "" || !!bad} onClick={() => onSet(id)}>
            Set the operator
          </Button>
          <Button type="button" variant="outline" disabled={!v.enabled || current === null} onClick={() => onSet(null)}>
            Remove the operator
          </Button>
        </div>
        {!v.enabled && v.reason && <p className="text-xs text-muted">{v.reason}</p>}
      </div>
    </Panel>
  );
}

function CeilingPanel({ live, v, onSave }: { live: Ok; v: ReturnType<typeof availability>; onSave: (raw: Record<string, unknown>, summary: string[]) => void }) {
  const c = live.view.ceiling;
  const reads = useMemo(() => createTestnetReads(), []);
  const [maxTx, setMaxTx] = useState(0);
  const [daily, setDaily] = useState(0);
  const [allowance, setAllowance] = useState(0);
  const [options, setOptions] = useState<TargetOption[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const key = JSON.stringify(c);
  useEffect(() => {
    if (!c) return;
    const near = c.tokens?.find((t) => t.token === "near");
    setMaxTx(yoctoToNum(near?.maxPerTx ?? c.maxPerTx));
    setDaily(yoctoToNum(near?.dailyTotal ?? c.dailyTotal));
    setAllowance(yoctoToNum(c.agentAllowance));
    let alive = true;
    readFactory(reads)
      .then(async (f) => {
        const found = await classifiedTargets(reads, f.registry, c.allowedTargets);
        if (!alive) return;
        setOptions(found);
        setMissing(c.allowedTargets.filter((t) => !found.some((o) => o.target === t)));
        setPicked(new Set(found.map((o) => o.target)));
      })
      .catch(() => alive && setNote("Could not read the registry, so targets cannot be listed. Try Refresh."));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reads]);

  if (!c) return null;

  const chosen = options.filter((o) => picked.has(o.target));
  const edit = { maxTx, daily, allowance, targets: chosen };
  const problem = ceilingEditProblem(edit);

  async function addExtra() {
    setNote(null);
    const id = extra.trim();
    if (!id) return;
    if (options.some((o) => o.target === id)) return setNote("Already in the list.");
    try {
      const f = await readFactory(reads);
      const t = await classifiedTarget(reads, f.registry, id);
      if (!t) return setNote(`The registry has no class for ${id}, so it cannot go in a ceiling. This console does not classify targets.`);
      setOptions((l) => [...l, t]);
      setPicked((s) => new Set(s).add(id));
      setExtra("");
    } catch {
      setNote("Could not read the registry. Try again.");
    }
  }

  function save() {
    if (!c || problem) return;
    onSave(ceilingToRaw(c, edit), [
      `max per transaction ${maxTx} NEAR, daily total ${daily} NEAR`,
      `agent gas allowance ${allowance} NEAR`,
      `allowed targets: ${chosen.map((t) => t.target).join(", ")}`,
    ]);
  }

  return (
    <Panel
      className="mt-6"
      title="Vault limits"
      aside={
        <Button type="button" disabled={!v.enabled || !!problem} onClick={save}>
          Save vault limits
        </Button>
      }
    >
      <p className="max-w-[70ch] text-sm leading-[1.6] text-muted">
        The most any agent on this vault can be given. Now: {yoctoToNear(c.maxPerTx)} NEAR per transaction, {yoctoToNear(c.dailyTotal)} NEAR a day, riskiest
        contracts allowed: {classLabelOf(c.maxRiskClass)}.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <NumberField label="Max per transaction" suffix={<TokenIcon t="NEAR" />} step={0.1} value={maxTx} onChange={setMaxTx} />
        <NumberField label="Daily total" suffix={<TokenIcon t="NEAR" />} step={0.5} value={daily} onChange={setDaily} />
        <NumberField label="Fee allowance per new agent" suffix={<TokenIcon t="NEAR" />} step={0.1} value={allowance} onChange={setAllowance} />
      </div>
      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Allowed contracts</legend>
        <ul className="mt-2 grid gap-2">
          {options.map((o) => (
            <li key={o.target} className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="accent-ink"
                  checked={picked.has(o.target)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(o.target);
                      else n.delete(o.target);
                      return n;
                    })
                  }
                />
                <span className="mono break-all text-sm">{o.target}</span>
              </label>
              <ClassTag c={o.class} target={o.target} />
              {o.frozen && <span className="mono border border-dawn-ink px-2 py-0.5 text-xs text-dawn-ink">frozen</span>}
            </li>
          ))}
          {missing.map((t) => (
            <li key={t} className="text-sm text-muted">
              <span className="mono break-all">{t}</span> has no class in the registry, so it cannot stay in the ceiling and is dropped on save.
            </li>
          ))}
        </ul>
        <div className="mt-4 sm:max-w-xl">
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <TextField label="Add a checked contract" mono value={extra} onChange={setExtra} />
            </div>
            <Button type="button" variant="outline" className="inline-flex h-[51px] items-center py-0!" onClick={addExtra} disabled={!extra.trim()}>
              Check
            </Button>
          </div>
          <p className="mt-1.5 text-sm text-muted">{note ?? "Checked against the registry, not classified here."}</p>
        </div>
      </fieldset>
      <p className="mt-4 text-sm text-dawn-ink">{problem}</p>
      {!v.enabled && v.reason && <p className="mt-1 text-xs text-muted">{v.reason}</p>}
    </Panel>
  );
}
