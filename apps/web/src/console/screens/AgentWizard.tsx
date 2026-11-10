"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { ACCESS_KEY_ROWS } from "@/landing/lib/facts";
import { vaultStore } from "../data/vault-mock";
import { ceilingProblem, type AgentRecord } from "../data/vault";
import { n0, n2 } from "../fmt";
import { policyPrice } from "../pricing";
import { useActions } from "../useActions";
import { useTargets } from "../useTargets";
import { ClassTag } from "../ui/ClassTag";
import { CopyBlock } from "../ui/CopyBlock";
import { NumberField, TextField } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { ClassPicker, LimitFields, TargetPicker, toPolicy, type PolicyDraft } from "../ui/PolicyFields";
import { agentHref } from "../ui/AgentsTable";
import { TokenIcon } from "../ui/Token";

const STEPS = ["Identity", "Policy", "Targets", "Funding", "Review"] as const;
const ID_RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const CONNECT = `const check = await mcp.call("aruna_simulate", params);
if (check.verdict === "allow") {
  await mcp.call("aruna_spend", params);
}`;

export function AgentWizard() {
  const { vault, actor, ask, run } = useActions();
  const { list, classes, classOf } = useTargets();
  const [step, setStep] = useState(1);
  const [id, setId] = useState(`agent-${vault.agents.length + 1}`);
  const [label, setLabel] = useState("");
  const [d, setD] = useState<PolicyDraft>({ maxTx: 25, cap: 100, slipPct: 0.5, maxClass: "local_upgradeable", targets: ["vault.testnet"] });
  const [deposit, setDeposit] = useState(500);
  const [gas, setGas] = useState(0.1);
  const [ack, setAck] = useState(false);
  const [created, setCreated] = useState<AgentRecord | null>(null);

  const policy = useMemo(() => toPolicy(d, classOf), [d, classes]); // eslint-disable-line react-hooks/exhaustive-deps
  const price = policyPrice(policy, classOf);
  const idOk = ID_RULE.test(id) && !vault.agents.some((a) => a.id === id);
  const ceiling = ceilingProblem(vault, policy);

  const problem: string | null =
    step === 1
      ? null
      : step === 2
        ? ceiling ?? (d.maxTx > d.cap ? "Max per transaction cannot exceed the daily cap." : null)
        : step === 3 && !policy.allowedTargets.length
          ? "Allow at least one target."
          : null;
  const ok =
    step === 1
      ? idOk && label.trim().length > 0
      : step === 2
        ? d.maxTx > 0 && d.cap > 0 && d.maxTx <= d.cap && !ceiling
        : step === 3
          ? policy.allowedTargets.length > 0
          : step === 4
            ? deposit >= 0 && gas > 0
            : ack;

  function create() {
    ask({
      title: "Add this agent?",
      actions: ["add agent: label, policy, public key", "contract adds the function-call key by promise"],
      note: `Then a deposit of ${n0(deposit)} USDC into the vault.`,
      okLabel: "Create the agent",
      onOk: () =>
        run(() => {
          setCreated(vaultStore.addAgent({ id, label: label.trim(), policy, deposit, allowanceNear: gas }, actor));
        }, `${id} was added to the vault.`),
    });
  }

  function again() {
    setCreated(null);
    setStep(1);
    setLabel("");
    setAck(false);
    setId(`agent-${vaultStore.get().agents.length + 1}`);
  }

  if (created) {
    const refused = ACCESS_KEY_ROWS.filter((r) => !r.action.startsWith("Parent"));
    return (
      <article>
        <p className="text-sm text-muted">
          <Link href="/console/agents/" className="underline underline-offset-4">
            Agents
          </Link>{" "}
          / New
        </p>
        <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">{created.label} is live</h1>
        <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
          Give this key to your agent&apos;s runtime. It can call the listed methods on one contract, and nothing else.
        </p>
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
          <Panel title="Connect your agent">
            <CopyBlock text={CONNECT} />
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-[120px_1fr]">
              <dt className="text-muted">Public key</dt>
              <dd className="mono">{created.publicKey}</dd>
              <dt className="text-muted">Receiver</dt>
              <dd className="mono">{vault.vault}</dd>
            </dl>
            <p className="mt-4 text-sm text-muted">The real app generates the key pair in your browser and shows it once. This prototype creates no key.</p>
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
              <Link href={agentHref(created.id)} tabIndex={-1}>
                <Button type="button">Open the agent</Button>
              </Link>
              <button type="button" onClick={again} className="cursor-pointer text-sm underline underline-offset-4">
                Create another agent
              </button>
            </div>
          </Panel>
        </div>
      </article>
    );
  }

  return (
    <article>
      <p className="text-sm text-muted">
        <Link href="/console/agents/" className="underline underline-offset-4">
          Agents
        </Link>{" "}
        / New
      </p>
      <h1 className="mt-3 text-[clamp(28px,4vw,44px)]">Create an agent</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">Set its limits before its key exists. The vault enforces them from its first call.</p>

      <ol className="mt-8 flex flex-wrap gap-x-6 gap-y-2" aria-label="Steps">
        {STEPS.map((n, i) => (
          <li key={n} aria-current={i + 1 === step ? "step" : undefined} className={`flex items-center gap-2 text-sm ${i + 1 === step ? "font-medium" : i + 1 < step ? "text-ink" : "text-muted"}`}>
            <b className={`inline-flex size-6 items-center justify-center border text-xs ${i + 1 === step ? "border-ink bg-ink text-paper" : i + 1 < step ? "border-ink" : "border-line-2"}`}>{i + 1}</b>
            {n}
          </li>
        ))}
      </ol>

      <Panel
        className="mt-6"
        title="Price of this policy"
        aside={<span className="text-sm text-muted">Mock model, assumptions apply</span>}
      >
        {price.priced ? (
          <p className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-[28px] leading-[1.1]">
              {n2(price.total)}
              <small className="ml-1 text-base text-muted">USDC per 30 days</small>
            </span>
            <span className="text-sm text-muted">
              Most it can send: {n0(price.limit)} USDC in 30 days · Priced as <ClassTag c={price.worst} />. Tighter limits lower this figure.
            </span>
          </p>
        ) : (
          <p className="text-sm text-slate">
            <span className="text-[28px] leading-[1.1]">Not priced.</span>{" "}
            {price.reason}
          </p>
        )}
      </Panel>

      <Panel className="mt-6" title={STEPS[step - 1]}>
        <div className="grid gap-6">
          {step === 1 && (
            <>
              <TextField
                label="Agent id"
                mono
                value={id}
                onChange={setId}
                hint={idOk ? `Added to ${vault.vault}.` : <span className="text-dawn-ink">Use lower-case letters, digits and hyphens, and an id that is not taken.</span>}
              />
              <TextField label="Label, shown on the public page" value={label} onChange={setLabel} />
              <p className="border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm leading-[1.6]">
                <strong className="font-medium">An agent is a key, not an account.</strong> The vault adds one function-call key for it.
                The key pair is generated in your browser, and only the public key leaves it.
              </p>
            </>
          )}
          {step === 2 && (
            <>
              <LimitFields d={d} set={setD} />
              <ClassPicker value={d.maxClass} onChange={(maxClass) => setD({ ...d, maxClass })} />
            </>
          )}
          {step === 3 && (
            <>
              <p className="max-w-[70ch] text-sm text-muted">
                Only targets with a named adapter can be called. There is no free call to an arbitrary contract. The riskiest class you
                allow also decides this key&apos;s method list.
              </p>
              <TargetPicker targets={list} classes={classes} d={d} set={setD} frozen={list.filter((t) => t.frozen).map((t) => t.id)} />
            </>
          )}
          {step === 4 && (
            <div className="grid gap-6 sm:grid-cols-2">
              <NumberField
                label="Deposit into the vault"
                suffix={<TokenIcon t="USDC" />}
                value={deposit}
                onChange={setDeposit}
                hint="Restricted keys cannot attach the 1 yoctoNEAR that NEP-141 requires, so the vault holds the funds."
              />
              <NumberField
                label="Gas allowance on the key"
                suffix={<TokenIcon t="NEAR" />}
                step={0.01}
                value={gas}
                onChange={setGas}
                hint="Paid from the vault's balance. Replace it any time. Gas per call is not measured on testnet yet."
              />
            </div>
          )}
          {step === 5 && (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
                <dt className="text-muted">Key on</dt>
                <dd className="mono">{vault.vault}</dd>
                <dt className="text-muted">Limits</dt>
                <dd>
                  {n0(policy.maxPerTx)} USDC per transaction, {n0(policy.dailyCap)} USDC a day, {(policy.maxSlippageBps / 100).toFixed(2)}% slippage
                </dd>
                <dt className="text-muted">Targets</dt>
                <dd className="mono">{policy.allowedTargets.join(", ") || "None"}</dd>
                <dt className="text-muted">Riskiest class</dt>
                <dd>
                  <ClassTag c={policy.maxRiskClass} />
                </dd>
                <dt className="text-muted">Funding</dt>
                <dd>
                  {n0(deposit)} USDC in the vault, {gas} NEAR gas allowance
                </dd>
              </dl>
              <div>
                <p className="label mb-2 text-xs text-muted">What the vault does</p>
                <pre className="mono border border-line-2 bg-wash p-4 text-[13px] leading-[1.6] whitespace-pre-wrap">{`owner calls the vault's add-agent method
the contract adds a function-call key to itself, by promise
receiver = the vault, classic allowance, no full-access key`}</pre>
              </div>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 accent-ink" />
                <span>I understand this key can only call the listed vault methods, and that revoking it deletes the key.</span>
              </label>
            </>
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button type="button" disabled={!ok} onClick={() => (step < 5 ? setStep(step + 1) : create())}>
            {step === 5 ? "Create the agent" : "Continue"}
          </Button>
          {problem && <span className="text-sm text-dawn-ink">{problem}</span>}
        </div>
      </Panel>
    </article>
  );
}
