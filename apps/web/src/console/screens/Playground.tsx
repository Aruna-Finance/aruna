"use client";

import { classLabelOf } from "@/landing/lib/class-labels";
import { reasonText } from "../reason-text";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AUTO_DISABLE_REASONS, readVault } from "@aruna/sdk";
import { AgentVault, nearApiTransport } from "@aruna/sdk/vault";
import { Button } from "@/shared/Button";
import { Select } from "@/shared/Select";
import { browserStore, keyInThisBrowser, loadKey } from "../agent-keys";
import { createTestnetReads } from "../chain-reads";
import { allPass, preRunChecks } from "../data/playground-checks";
import { END_TEXT, markRunEnded, markRunStarted, runAttempts, wasInterrupted, type AgentNow, type RunEnd, type StepState } from "../data/playground-run";
import { attemptsFor, SCENARIOS, SWAP_TARGET, type ScenarioId } from "../data/playground-scenarios";
import { yoctoToNear } from "../fmt";
import { explorerTxUrl } from "../tx-status";
import { useLiveVault } from "../useLiveVault";
import { NoVault } from "../ui/NoVault";
import { Panel } from "../ui/Panel";
import { PageHeader } from "../ui/PageHeader";

// The playground sends real spend calls to the vault with an agent key held in this browser (plan U7, R22, KTD8).
// It does not simulate anything and does not check a policy itself: the vault decides, and a refusal is shown with
// the reason the vault returned (CLAUDE.md rules 9 and 10). Testnet only.

const NETWORK = "testnet";
const RPC = "https://rpc.testnet.fastnear.com";

const stepText = (s: StepState): string => {
  switch (s.kind) {
    case "queued":
      return "Queued";
    case "sending":
      return "Sending";
    case "settled":
      return "Settled";
    case "refused":
      return `Refused: ${reasonText(s.reason) ?? s.reason} (${s.reason})${s.targetClass ? `, contract risk: ${classLabelOf(s.targetClass)}` : ""}`;
    case "failed":
      return `Failed: ${s.message}`;
    case "skipped":
      return "Not sent";
  }
};

export function Playground() {
  const live = useLiveVault();
  if (live.status !== "ok") return <NoVault live={live} title="Playground" />;
  return <LivePlayground live={live} />;
}

function LivePlayground({ live }: { live: Extract<ReturnType<typeof useLiveVault>, { status: "ok" }> }) {
  const { vault, view, held, refresh } = live;
  const store = useMemo(() => browserStore(), []);
  const reads = useMemo(() => createTestnetReads(), []);

  const offered = view.agents.filter((a) => a.status !== "Revoked" && keyInThisBrowser(held, a.publicKey));
  const [pk, setPk] = useState<string>("");
  const agent = offered.find((a) => a.publicKey === pk) ?? offered[0] ?? null;
  const [scenario, setScenario] = useState<ScenarioId>("injected");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [running, setRunning] = useState(false);
  const [end, setEnd] = useState<RunEnd | null>(null);
  const [after, setAfter] = useState<AgentNow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const stopRef = useRef(false);

  const loadBalance = useCallback(() => {
    reads.balance(vault).then(setBalance, () => setBalance(null));
  }, [reads, vault]);
  useEffect(loadBalance, [loadBalance]);

  const agentKey = agent?.publicKey ?? "";
  useEffect(() => {
    setInterrupted(!running && agentKey !== "" && wasInterrupted(store, vault, agentKey));
  }, [store, vault, agentKey, running]);

  const attempts = useMemo(() => attemptsFor(scenario, balance ?? 0n), [scenario, balance]);
  const checks = preRunChecks({ vault, view, agent, held, swapTarget: SWAP_TARGET, balance, attempts });
  const ready = allPass(checks) && !running;

  async function run() {
    if (!agent) return;
    const key = loadKey(store, NETWORK, vault, agent.publicKey);
    if (!key) {
      setProblem("The browser does not hold this agent's key.");
      return;
    }
    stopRef.current = false;
    setProblem(null);
    setEnd(null);
    setAfter(null);
    setSteps(attempts.map(() => ({ kind: "queued" })));
    setRunning(true);
    markRunStarted(store, vault, agent.publicKey);
    const av = new AgentVault({ vaultId: vault, transport: nearApiTransport({ signerId: vault, privateKey: key.secret, network: NETWORK, rpcUrl: RPC }) });
    const readAgent = async (): Promise<AgentNow | null> => {
      const v = await readVault(vault, { network: NETWORK });
      const a = v.agents.find((x) => x.publicKey === agent.publicKey);
      return a ? { status: a.status, autoDisabled: a.autoDisabled } : null;
    };
    try {
      // The agent pulls the target's class into the vault's cache first, as the example agents do.
      await av.refreshClass(SWAP_TARGET);
      const r = await runAttempts({
        attempts,
        spend: (a) => av.spend({ adapter: a.adapter, target: a.target, amount: a.amount, minAmountOut: a.minAmountOut }),
        readAgent,
        shouldStop: () => stopRef.current,
        onStep: (i, s) => setSteps((prev) => prev.map((x, j) => (j === i ? s : x))),
      });
      setEnd(r.end);
      setAfter(r.agent);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The run could not start.");
      setEnd("failed");
    } finally {
      markRunEnded(store, vault, agent.publicKey);
      setRunning(false);
      refresh();
      loadBalance();
    }
  }

  return (
    <article>
      <PageHeader title="Playground">
        Send real testnet calls from an agent key in this browser and watch the vault allow or refuse them. Enough refusals stop the agent
        automatically.
      </PageHeader>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Choose a run">
          {offered.length === 0 ? (
            <p className="max-w-[70ch] text-[15px] leading-[1.6] text-slate">
              No agent of this vault has its key in this browser, so there is nobody to run.{" "}
              <Link href={`/console/agents/new/?vault=${encodeURIComponent(vault)}`} className="underline underline-offset-4">
                Create an agent
              </Link>{" "}
              here first.
            </p>
          ) : (
            <div className="grid gap-5">
              <div>
                <p className="text-sm font-medium">Agent <span className="font-normal text-muted">(only agents whose key is in this browser)</span></p>
                <Select
                  label="Agent"
                  value={agent?.publicKey ?? ""}
                  onValueChange={setPk}
                  options={offered.map((a) => ({ value: a.publicKey, label: `${a.label} (${a.autoDisabled ? "stopped by vault" : a.status})` }))}
                  className="mt-1.5 w-full max-w-md"
                />
              </div>
              <fieldset className="grid gap-2" disabled={running}>
                <legend className="mb-1 text-sm text-muted">Scenario</legend>
                {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => (
                  <label key={id} className="flex items-start gap-3 text-[15px]">
                    <input type="radio" name="scenario" className="mt-1.5" checked={scenario === id} onChange={() => setScenario(id)} />
                    <span>
                      <span className="font-medium">{SCENARIOS[id].title}</span>
                      <span className="block max-w-[70ch] text-sm leading-[1.6] text-slate">{SCENARIOS[id].what}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
          )}
        </Panel>

        <Panel title="Before it starts" aside={<span className="text-sm text-muted">Vault balance {balance === null ? "unknown" : `${yoctoToNear(balance.toString())} NEAR`}</span>}>
          <ul className="grid gap-3">
            {checks.map((c) => (
              <li key={c.id} className="text-[15px]">
                <span className={c.ok ? "" : "font-medium text-dawn-ink"}>{c.ok ? "Ready" : "Not ready"}: </span>
                {c.label}
                {!c.ok && (
                  <span className="mt-1 block max-w-[70ch] text-sm leading-[1.6] text-slate">
                    {c.reason}
                    {c.fix && (
                      <>
                        {" "}
                        <Link href={c.fix.href} className="underline underline-offset-4">
                          {c.fix.label}
                        </Link>
                      </>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {interrupted && !running && (
            <p className="mt-5 border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">
              A previous run was interrupted. On chain this agent is {agent?.autoDisabled ? "stopped by the vault" : (agent?.status ?? "unknown")}.{" "}
              <button type="button" className="underline underline-offset-4" onClick={() => agent && (markRunEnded(store, vault, agent.publicKey), setInterrupted(false))}>
                Dismiss
              </button>
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!ready} onClick={run}>
              {running ? "Running" : "Run the scenario"}
            </Button>
            {running && (
              <Button type="button" variant="outline" onClick={() => (stopRef.current = true)}>
                Stop
              </Button>
            )}
          </div>
          {problem && <p className="mt-4 border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">{problem}</p>}
        </Panel>

        {steps.length > 0 && (
          <Panel title="What happened" aside={end && <span className="text-sm text-muted">{END_TEXT[end]}</span>}>
            <ol className="grid gap-4">
              {attempts.map((a, i) => {
                const s = steps[i] ?? { kind: "queued" };
                const tx = s.kind === "settled" || s.kind === "refused" ? s.tx : null;
                return (
                  <li key={a.id} className="text-[15px]">
                    <p>
                      {i + 1}. {a.intent}
                    </p>
                    <p className="mono text-sm text-muted">
                      spend({a.target}, {yoctoToNear(a.amount)} NEAR)
                    </p>
                    <p className={`text-sm ${s.kind === "refused" || s.kind === "failed" ? "text-dawn-ink" : ""}`} aria-live="polite">
                      {stepText(s)}
                      {tx && (
                        <>
                          {" "}
                          <a href={explorerTxUrl(tx)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                            View transaction
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                );
              })}
            </ol>
            {after && (
              <p className="mt-6 border-t border-line-2 pt-4 text-[15px]">
                On chain now: this agent is <span className="font-medium">{after.autoDisabled ? "Stopped by the vault" : after.status}</span>.{" "}
                <Link href={`/console/agents/?vault=${encodeURIComponent(vault)}`} className="underline underline-offset-4">
                  Open the agents
                </Link>
                {after.autoDisabled && " Only the owner can resume it."}
              </p>
            )}
          </Panel>
        )}

        <Panel title="When the vault stops an agent">
          <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
            Only refusals the agent caused count. A contract reclassified or frozen under an honest agent does not.
          </p>
          <ul className="mt-3 grid gap-1 text-sm">
            {AUTO_DISABLE_REASONS.map((r) => (
              <li key={r}>
                {reasonText(r)} <span className="mono text-xs text-muted">{r}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </article>
  );
}
