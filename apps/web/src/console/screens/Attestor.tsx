"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/shared/Button";
import { Select } from "@/shared/Select";
import { toast } from "@/shared/Toaster";
import { attestorStore } from "../data/attestor";
import { channelsOf, type ChannelKey } from "../data/channels";
import { CLAIMS_ASSUME } from "../data/claims";
import { claimsStore, resolvedHash } from "../data/claims-mock";
import { COVERAGE_ASSUME } from "../data/coverage";
import { coverageStore } from "../data/coverage-mock";
import { n0 } from "../fmt";
import { useTx } from "../TxContext";
import { useClaims } from "../useClaims";
import { useCoverage } from "../useCoverage";
import { useTargets } from "../useTargets";
import { ClaimPill, reportHref } from "../ui/ClaimPill";
import { ClassTag } from "../ui/ClassTag";
import { HeartbeatAlert } from "../ui/CoverageNotes";
import { NumberField, TextField } from "../ui/Field";
import { Panel } from "../ui/Panel";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";
const CHANNELS: ChannelKey[] = ["resolved_code", "deploy_contract", "use_global_contract", "deploy_global_contract"];
const short = (h: string) => `${h.slice(0, 6)}...${h.slice(-4)}`;

export function Attestor() {
  const { attestors, policies } = useCoverage();
  const { reports } = useClaims();
  const { list } = useTargets();
  const { pending } = useSyncExternalStore(attestorStore.subscribe, attestorStore.get, attestorStore.get);
  const { open } = useTx();

  const [target, setTarget] = useState("dex.testnet");
  const [who, setWho] = useState("attestor-1.testnet");
  const [channel, setChannel] = useState<ChannelKey>("resolved_code");
  const [ago, setAgo] = useState(240);
  const [after, setAfter] = useState("");

  const book = useMemo(() => coverageStore.book(), [policies]); // eslint-disable-line react-hooks/exhaustive-deps
  const covered = (id: string) => book.filter((p) => p.target === id && p.status !== "expired").length;
  const stale = attestors.filter((a) => a.heartbeatAgeBlocks > COVERAGE_ASSUME.heartbeatMaxAgeBlocks);
  const before = resolvedHash(target, "before");
  const prefill = resolvedHash(target, "after");

  function attempt(f: () => void, done: string) {
    try {
      f();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The registry refused the call.");
    }
  }

  function prepare(t: string, ch: ChannelKey) {
    setTarget(t);
    setChannel(ch);
    setAfter(resolvedHash(t, "after"));
    document.getElementById("report-form")?.scrollIntoView({ block: "start" });
  }

  function upgrade(id: string) {
    const rec = list.find((t) => t.id === id);
    if (!rec) return;
    open({
      title: `Upgrade ${id}?`,
      signer: rec.classification.evidence.codeRef?.kind === "global_account" ? rec.classification.evidence.codeRef.ownerAccount : id,
      receiver: rec.classification.evidence.codeRef?.kind === "global_account" ? rec.classification.evidence.codeRef.ownerAccount : id,
      actions: [rec.classification.evidence.codeRef?.kind === "global_account" ? "DeployGlobalContract" : "DeployContract"],
      note:
        rec.classification.evidence.codeRef?.kind === "global_account"
          ? "This deploys on the owner's account. No transaction touches the target, and its account code_hash stays the same."
          : "This simulates the target owner shipping new code.",
      okLabel: "Deploy new code",
      danger: true,
      onOk: () => attempt(() => attestorStore.upgrade(rec, list), "New code is live. The channels below show the change."),
    });
  }

  function send() {
    const hash = (after || prefill).trim();
    open({
      title: "Send a drift report?",
      signer: who,
      receiver: "registry.aruna.testnet",
      actions: [`report_drift on ${target}, channel ${channel}`],
      note: `This locks a ${n0(CLAIMS_ASSUME.attestorBond)} USDC bond. The contract checks the lookback bound and that the two resolved hashes differ. It cannot check that your changedAtBlock is true.`,
      okLabel: "Send the report",
      onOk: () =>
        attempt(() => {
          const r = claimsStore.reportDrift(target, { attestor: who, channel, agoBlocks: ago, afterHash: hash });
          attestorStore.reported(target);
          toast.message(`Report ${r.id} is open. Claims follow the challenge window.`);
        }, "Report sent. The bond is locked."),
    });
  }

  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Attestor console</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        The attestor must be trusted, permanently. Every route to detection with no outside party was tested and is closed. At the MVP
        the dispute arbiter is a second trust assumption.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        {pending.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-4 border-l-[3px] border-dawn bg-dawn-wash px-5 py-4">
            <p className="max-w-[80ch] leading-[1.6]">
              <strong className="font-medium">
                Change seen on <span className="mono">{d.target}</span> via {d.channel}.
              </strong>{" "}
              {d.owner ? (
                <>
                  Owner <span className="mono">{d.owner}</span> redeployed. <span className="mono">view_account.code_hash</span> did not
                  change. Also affects {d.affects.length ? d.affects.join(", ") : "no other target"}.
                </>
              ) : (
                "Resolved code hash changed."
              )}
            </p>
            <Button type="button" onClick={() => prepare(d.target, d.channel)}>
              Prepare the report
            </Button>
          </div>
        ))}

        <HeartbeatAlert attestors={attestors} />
        {stale.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {stale.map((a) => (
              <Button
                key={a.id}
                type="button"
                variant="outline"
                onClick={() => {
                  coverageStore.restartAttestor(a.id);
                  toast.success(`${a.id} restarted. Its heartbeat is current.`);
                }}
              >
                Restart {a.id}
              </Button>
            ))}
          </div>
        )}

        <dl className="grid gap-px border border-line-2 bg-line-2 sm:grid-cols-2 lg:grid-cols-4">
          {attestors.map((a) => {
            const mine = reports.filter((r) => r.attestor === a.id);
            const locked = mine.filter((r) => r.status === "challenge_window" || r.status === "disputed").length * CLAIMS_ASSUME.attestorBond;
            const slashed = mine.filter((r) => r.status === "rejected").length * CLAIMS_ASSUME.attestorBond;
            const dead = a.heartbeatAgeBlocks > COVERAGE_ASSUME.heartbeatMaxAgeBlocks;
            return (
              <div key={a.id} className="bg-paper p-6">
                <dt className="mono text-sm">{a.id}</dt>
                <dd className="mt-2 text-[28px] leading-none">
                  {n0(CLAIMS_ASSUME.attestorBond)}
                  <small className="ml-1 text-base text-muted">USDC bond</small>
                </dd>
                <p className="mt-2 text-sm text-muted">
                  {n0(locked)} locked, {slashed ? <span className="text-dawn-ink">{n0(slashed)} slashed</span> : "none slashed"}, {mine.length}{" "}
                  reports,{" "}
                  {dead ? <span className="text-dawn-ink">heartbeat {n0(a.heartbeatAgeBlocks)} blocks ago</span> : `heartbeat ${n0(a.heartbeatAgeBlocks)} blocks ago`}
                </p>
              </div>
            );
          })}
          <div className="bg-paper p-6">
            <dt className="text-sm text-muted">Targets monitored</dt>
            <dd className="mt-2 text-[28px] leading-none">{list.length}</dd>
            <p className="mt-2 text-sm text-muted">Poll every {CLAIMS_ASSUME.pollIntervalSec} seconds (assumption)</p>
          </div>
          <div className="bg-paper p-6">
            <dt className="text-sm text-muted">Max lookback</dt>
            <dd className="mt-2 text-[28px] leading-none">
              {n0(CLAIMS_ASSUME.maxLookbackBlocks)}
              <small className="ml-1 text-base text-muted">blocks</small>
            </dd>
            <p className="mt-2 text-sm text-muted">Bounds backdating (assumption)</p>
          </div>
        </dl>

        <Panel title="Monitored targets" aside={<span className="text-sm text-muted">Four channels, all needed</span>}>
          <p className="mb-4 max-w-[80ch] text-sm text-slate">
            The last column simulates the target owner shipping new code, so you can watch detection work.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th className={th}>Target</th>
                  <th className={th}>Class</th>
                  {["view_code", "DeployContract", "UseGlobalContract", "DeployGlobalContract"].map((c) => (
                    <th key={c} className={`${th} mono`}>
                      {c}
                    </th>
                  ))}
                  <th className={`${th} text-right`}>Policies</th>
                  <th className={th}>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => {
                  const d = pending.find((x) => x.target === t.id);
                  const ch = channelsOf(t, d?.channel ?? null);
                  return (
                    <tr key={t.id}>
                      <td className={`${td} mono`}>
                        <Link href={`/console/targets/detail/?id=${encodeURIComponent(t.id)}`} className="underline underline-offset-4">
                          {t.id}
                        </Link>
                      </td>
                      <td className={td}>
                        <ClassTag c={t.classification.class} />
                      </td>
                      {ch.map((c) => (
                        <td key={c.key} className={`${td} text-sm ${c.state === "changed" ? "text-dawn-ink" : c.state === "not applicable" ? "text-muted" : ""}`}>
                          {c.state === "not applicable" ? "n/a" : c.state}
                        </td>
                      ))}
                      <td className={`${td} mono text-right`}>{covered(t.id)}</td>
                      <td className={`${td} text-right`}>
                        {t.classification.class === "immutable_verified" ? (
                          <span className="text-sm text-muted">Cannot change</span>
                        ) : t.classification.evidence.wasmParsed ? (
                          <Button type="button" variant="outline" onClick={() => upgrade(t.id)}>
                            Upgrade target
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div id="report-form">
          <Panel title="Report drift">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-sm font-medium">Target</p>
                <Select
                  label="Target"
                  value={target}
                  onValueChange={(v) => {
                    setTarget(v);
                    setAfter("");
                  }}
                  options={list.map((t) => ({ value: t.id, label: t.id }))}
                  className="mt-1.5 w-full"
                />
              </div>
              <div>
                <p className="text-sm font-medium">Attestor</p>
                <Select label="Attestor" value={who} onValueChange={setWho} options={attestors.map((a) => ({ value: a.id, label: a.id }))} className="mt-1.5 w-full" />
              </div>
              <div>
                <p className="text-sm font-medium">Channel</p>
                <Select
                  label="Channel"
                  value={channel}
                  onValueChange={(v) => setChannel(v as ChannelKey)}
                  options={CHANNELS.map((c) => ({ value: c, label: c }))}
                  className="mt-1.5 w-full"
                />
              </div>
              <NumberField
                label="Blocks since the change"
                suffix="blocks"
                min={0}
                value={ago}
                onChange={setAgo}
                hint="Sets changedAtBlock. The contract only checks the lookback bound."
              />
              <div className="sm:col-span-2">
                <TextField
                  label="Code hash after the change"
                  value={after || prefill}
                  onChange={setAfter}
                  mono
                  hint={
                    <>
                      Before: <span className="mono">{short(before)}</span>. An equal hash is rejected. A wrong hash can be disputed, and the arbiter can
                      slash the bond.
                    </>
                  }
                />
              </div>
            </div>
            <div className="mt-6">
              <Button type="button" onClick={send}>
                Send the report
              </Button>
            </div>
          </Panel>
        </div>

        <Panel title="What an attestor controls">
          <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
            An attestor reports whether a change happened and at which block. A contract cannot check a claim about a past block, so moving
            that block could decide who gets paid.
          </p>
          <ul className="mt-4 grid gap-2 text-sm">
            {[
              "A bond that can be slashed",
              "A time sanity bound on the claimed block",
              "A challenge window before any payout",
              "A dispute, with an arbiter, on conflicting reports",
            ].map((x) => (
              <li key={x} className="flex gap-3">
                <i aria-hidden className="mt-1.5 block size-2 shrink-0 bg-ink" />
                {x}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">These reduce the trust placed in an attestor. They do not remove it.</p>
        </Panel>

        <Panel title="Reports">
          {reports.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[15px]">
                <thead>
                  <tr>
                    <th className={th}>Target</th>
                    <th className={th}>Attestor</th>
                    <th className={th}>Channel</th>
                    <th className={th}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id}>
                      <td className={`${td} mono`}>
                        <Link href={reportHref(r.id)} className="underline underline-offset-4">
                          {r.target}
                        </Link>
                      </td>
                      <td className={`${td} mono`}>{r.attestor}</td>
                      <td className={`${td} mono`}>{r.channel}</td>
                      <td className={td}>
                        <ClaimPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No reports sent yet.</p>
          )}
        </Panel>
      </div>
    </article>
  );
}
