"use client";
import { shortKey } from "../fmt";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { WithPlus } from "@/shared/WithPlus";
import { PageHeader } from "../ui/PageHeader";
import { ACCESS_KEY_ROWS } from "@/landing/lib/facts";
import { policyProblem } from "../agent-actions";
import { browserStore, exportText, forgetKey, generateAgentKey, KEY_LABEL, saveKey } from "../agent-keys";
import { createTestnetReads } from "../chain-reads";
import { mcpAgentCommand, KEY_FILE_NOTE } from "../data/agent-connect";
import { defaultDraft, draftToPolicy, type LiveDraft } from "../data/agent-draft";
import { publicKeyProblem } from "../data/agent-key-input";
import { classifiedTargets, readFactory, type TargetOption } from "../data/factory";
import { actorFor, noActorReason } from "../live-vault";
import { useLiveActions } from "../useLiveActions";
import type { LiveVault } from "../useLiveVault";
import { useRole } from "../RoleContext";
import { useWallet } from "../WalletContext";
import { relationOf } from "../walletRole";
import { ClassTag } from "../ui/ClassTag";
import { CopyBlock } from "../ui/CopyBlock";
import { NumberField, TextField } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { ClassPicker } from "../ui/PolicyFields";
import { TokenIcon } from "../ui/Token";

const STEPS = ["Identity", "Limits", "Contracts", "Review"] as const;
const NETWORK = "testnet";

const CONNECT = `const check = await mcp.call("aruna_simulate", params);
if (check.verdict === "allow") {
  await mcp.call("aruna_spend", params);
}`;

function download(name: string, text: string) {
  const el = document.createElement("a");
  el.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  el.download = name;
  el.click();
  URL.revokeObjectURL(el.href);
}

/** The agent wizard on a real vault: the key pair is made in this tab, only the public key goes on chain. */
export function LiveAgentWizard({ live }: { live: Extract<LiveVault, { status: "ok" }> }) {
  const { accountId } = useWallet();
  const { role } = useRole();
  const { view, vault, refresh } = live;
  const acts = useLiveActions(vault, refresh);
  const relation = relationOf(accountId, view);
  const actor = actorFor(relation, role);
  const ceiling = view.ceiling;

  const [step, setStep] = useState(1);
  const [label, setLabel] = useState("");
  const [d, setD] = useState<LiveDraft | null>(null);
  const [ack, setAck] = useState(false);
  const [key, setKey] = useState(() => generateAgentKey());
  const [own, setOwn] = useState(false);
  const [ownKey, setOwnKey] = useState("");
  const [created, setCreated] = useState<{ publicKey: string; label: string; stored: boolean; own: boolean } | null>(null);
  const [problemNote, setProblemNote] = useState<string | null>(null);
  const [options, setOptions] = useState<TargetOption[]>([]);

  const reads = useMemo(() => createTestnetReads(), []);
  useEffect(() => {
    if (ceiling && d === null) setD(defaultDraft(ceiling));
  }, [ceiling, d]);

  useEffect(() => {
    if (!ceiling) return;
    let alive = true;
    readFactory(reads)
      .then((f) => classifiedTargets(reads, f.registry, ceiling.allowedTargets))
      .then((t) => alive && setOptions(t))
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [ceiling, reads]);

  if (!ceiling || !d) {
    return (
      <article>
        <PageHeader title="Create an agent">
          {ceiling ? "Reading the vault." : "This vault's version does not expose a ceiling, so a policy cannot be checked against it. Nothing is signed."}
        </PageHeader>
      </article>
    );
  }

  const policy = draftToPolicy(d);
  const problem = policyProblem(policy, ceiling);
  const labelOk = label.trim().length > 0 && label.trim().length <= 64 && (!own || publicKeyProblem(ownKey) === null);
  const ok = step === 1 ? labelOk : step === 2 ? !problem || !["limits", "maxPerTx", "dailyCap", "maxRiskClass", "maxSlippageBps"].includes(problem.field) : step === 3 ? d.targets.length > 0 && !problem : ack && !problem && !!actor;
  const shown = step === 2 || step === 3 ? problem?.message : null;
  const classOf = (t: string) => options.find((o) => o.target === t);

  function create() {
    if (!actor || problem) return;
    if (own) {
      // The key is held elsewhere: nothing is stored here, and a failed call has no local key to undo.
      const publicKey = ownKey.trim();
      if (publicKeyProblem(publicKey) !== null) return;
      acts.addAgent({ publicKey, label: label.trim(), policy, onDone: () => setCreated({ publicKey, label: label.trim(), stored: false, own: true }), onFail: () => {} });
      return;
    }
    const stored = saveKey(browserStore(), { network: NETWORK, vault, ...key });
    if (!stored) {
      setProblemNote("This browser refuses to store the key (private window or blocked site data). Allow site data, or export the key first, then try again.");
      return;
    }
    setProblemNote(null);
    acts.addAgent({
      publicKey: key.publicKey,
      label: label.trim(),
      policy,
      onDone: () => setCreated({ publicKey: key.publicKey, label: label.trim(), stored, own: false }),
      onFail: () => forgetKey(browserStore(), NETWORK, vault, key.publicKey),
    });
  }

  function again() {
    setCreated(null);
    setStep(1);
    setLabel("");
    setOwn(false);
    setOwnKey("");
    setAck(false);
    setD(defaultDraft(ceiling!));
    setKey(generateAgentKey());
  }

  const crumbs = (
    <p className="text-sm text-muted">
      <Link href="/console/agents/" className="underline underline-offset-4">
        Agents
      </Link>{" "}
      / New
    </p>
  );

  if (created) {
    const refused = ACCESS_KEY_ROWS.filter((r) => !r.action.startsWith("Parent"));
    return (
      <article>
        <PageHeader title={`${created.label} is live`} lead={crumbs}>
          Give this key to your agent&apos;s runtime. It can call the listed methods on one contract, and nothing else.
        </PageHeader>
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
          <Panel title="Connect your agent">
            <CopyBlock text={CONNECT} />
            {created.own && (
              <div className="mt-5">
                <p className="mb-2 text-sm text-muted">Start the MCP server for this agent. {KEY_FILE_NOTE}</p>
                <CopyBlock text={mcpAgentCommand(vault)} />
              </div>
            )}
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-[120px_1fr]">
              <dt className="text-muted">Public key</dt>
              <dd className="mono break-all">{created.publicKey}</dd>
              <dt className="text-muted">Receiver</dt>
              <dd className="mono break-all">{vault}</dd>
              <dt className="text-muted">Private key</dt>
              <dd>
                {created.own
                  ? "Held by you, outside this browser. This page never saw it, so it cannot export it and the Playground cannot sign for this agent."
                  : `Kept in this browser only, labelled "${KEY_LABEL}". Clearing site data loses it, so export it now.`}
              </dd>
            </dl>
            {!created.own && (
              <div className="mt-5">
                <Button type="button" variant="outline" onClick={() => download("agent-key.txt", exportText({ network: NETWORK, vault, publicKey: key.publicKey, secret: key.secret }))}>
                  Export the key
                </Button>
              </div>
            )}
          </Panel>
          <Panel title="What the protocol refuses this key">
            <ul className="grid gap-2 text-[15px]">
              {refused.map((r) => (
                <li key={r.action} className="flex gap-3 border-t border-line pt-2">
                  <span aria-hidden className="mt-2 size-2 shrink-0 bg-dawn-ink" />
                  {r.action}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link href="/console/agents/" tabIndex={-1}>
                <Button type="button">Back to agents</Button>
              </Link>
              <button type="button" onClick={again} className="cursor-pointer text-sm underline underline-offset-4">
                <WithPlus>Create another agent</WithPlus>
              </button>
            </div>
          </Panel>
        </div>
      </article>
    );
  }

  return (
    <article>
      <PageHeader title="Create an agent" lead={crumbs}>
        Set its limits first. The vault enforces them from the agent&apos;s first call. Vault: <span className="mono break-all">{vault}</span>.
      </PageHeader>

      <ol className="mt-8 flex flex-wrap gap-x-6 gap-y-2" aria-label="Steps">
        {STEPS.map((n, i) => (
          <li key={n} aria-current={i + 1 === step ? "step" : undefined} className={`flex items-center gap-2 text-sm ${i + 1 === step ? "font-medium" : i + 1 < step ? "text-ink" : "text-muted"}`}>
            <b className={`inline-flex size-6 items-center justify-center border text-xs ${i + 1 === step ? "border-ink bg-ink text-paper" : i + 1 < step ? "border-ink" : "border-line-2"}`}>{i + 1}</b>
            {n}
          </li>
        ))}
      </ol>

      <Panel className="mt-6" title={STEPS[step - 1]}>
        <div className="grid gap-6">
          {step === 1 && (
            <>
              <TextField label="Label, shown on the public page" value={label} onChange={setLabel} />
              <fieldset className="grid gap-2 text-sm">
                <legend className="mb-1 font-medium">Where the key lives</legend>
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="radio" name="key-home" checked={!own} onChange={() => setOwn(false)} className="mt-1 accent-ink" />
                  <span>Create a key in this browser (to try the agent in the Playground)</span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="radio" name="key-home" checked={own} onChange={() => setOwn(true)} className="mt-1 accent-ink" />
                  <span>Use a key I already have</span>
                </label>
              </fieldset>
              {own ? (
                <TextField label="Agent public key" mono value={ownKey} onChange={setOwnKey} hint={ownKey.trim() !== "" ? (publicKeyProblem(ownKey) ?? "That is a valid ed25519 public key.") : undefined} />
              ) : (
                <>
                  <p className="text-sm leading-[1.6] text-slate">Only the public key leaves your browser.</p>
                  <p className="mono break-all text-xs text-muted" title={key.publicKey}>Key: {shortKey(key.publicKey)}</p>
                </>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField label="Max per transaction" suffix={<TokenIcon t="NEAR" />} step={0.05} value={d.maxTx} onChange={(v) => setD({ ...d, maxTx: v })} />
                <NumberField label="Daily cap" suffix={<TokenIcon t="NEAR" />} step={0.1} value={d.cap} onChange={(v) => setD({ ...d, cap: v })} />
                <NumberField
                  label="Max slippage"
                  suffix="%"
                  step={0.05}
                  value={d.slipPct}
                  onChange={(v) => setD({ ...d, slipPct: v })}
                  hint="Only as strong as the DEX's own min_amount_out. The vault has no price source."
                />
              </div>
              <ClassPicker value={d.maxClass} onChange={(maxClass) => setD({ ...d, maxClass })} />
            </>
          )}
          {step === 3 && (
            <>
              <p className="max-w-[70ch] text-sm text-muted">
                Only targets in the owner&apos;s ceiling can be allowed, and only through a named adapter. There is no free call to an arbitrary contract.
              </p>
              <ul className="grid gap-3">
                {ceiling.allowedTargets.map((t) => {
                  const o = classOf(t);
                  return (
                    <li key={t} className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="accent-ink"
                          checked={d.targets.includes(t)}
                          onChange={(e) => setD({ ...d, targets: e.target.checked ? [...d.targets, t] : d.targets.filter((x) => x !== t) })}
                        />
                        <span className="mono text-sm">{t}</span>
                      </label>
                      {o && <ClassTag c={o.class} target={t} />}
                      {o?.frozen && <span className="mono border border-dawn-ink px-2 py-0.5 text-xs text-dawn-ink">frozen: spends are refused</span>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {step === 4 && (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
                <dt className="text-muted">Key on</dt>
                <dd className="mono break-all">{vault}</dd>
                <dt className="text-muted">Label</dt>
                <dd>{label.trim()}</dd>
                <dt className="text-muted">Limits</dt>
                <dd>
                  {d.maxTx} NEAR per transaction, {d.cap} NEAR a day, {d.slipPct.toFixed(2)}% slippage
                </dd>
                <dt className="text-muted">Targets</dt>
                <dd className="mono break-all">{d.targets.join(", ") || "None"}</dd>
                <dt className="text-muted">Riskiest class</dt>
                <dd>
                  <ClassTag c={d.maxClass} />
                </dd>
              </dl>
              <div>
                <p className="label mb-2 text-xs text-muted">What the vault does</p>
                <pre className="mono border border-line-2 bg-wash p-4 text-[13px] leading-[1.6] whitespace-pre-wrap">{`you call the vault's add_agent method with 1 yoctoNEAR
the contract adds a function-call key to itself, by promise
receiver = the vault, classic allowance, no full-access key`}</pre>
              </div>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-ink" />
                <span>I understand this key can only call the listed vault methods, and that revoking it deletes the key.</span>
              </label>
              {!actor && <p className="text-sm text-dawn-ink">{noActorReason(relation)}.</p>}
            </>
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button type="button" disabled={!ok} onClick={() => (step < 4 ? setStep(step + 1) : create())}>
            {step === 4 ? <WithPlus>Create the agent</WithPlus> : "Continue"}
          </Button>
          {shown && <span className="text-sm text-dawn-ink">{shown}</span>}
          {problemNote && <span className="text-sm text-dawn-ink">{problemNote}</span>}
        </div>
      </Panel>
    </article>
  );
}
