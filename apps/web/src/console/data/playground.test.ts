import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentView, VaultView } from "@aruna/sdk";
import { nearToYocto } from "../fmt";
import { allPass, preRunChecks } from "./playground-checks";
import { markRunEnded, markRunStarted, runAttempts, wasInterrupted, type AgentNow, type SpendOutcome } from "./playground-run";
import { honestAttempts, injectedAttempts, SWAP_TARGET, type Attempt } from "./playground-scenarios";

const BAL = nearToYocto(3);

describe("scenario list", () => {
  it("has the same attempts, in the same order, as the recorded run in examples/README.md", () => {
    const readme = readFileSync(fileURLToPath(new URL("../../../../../examples/README.md", import.meta.url)), "utf8");
    const recorded = [...readme.matchAll(/^(\d+)\. (.+): spend\(([^,]+), ([\d.]+) NEAR\)/gm)].map((m) => ({ intent: m[2], target: m[3] }));
    expect(recorded.length).toBe(6);
    expect(injectedAttempts(BAL).map((a) => ({ intent: a.intent, target: a.target }))).toEqual(recorded);
  });
  it("the honest scenario is the one in-policy swap, with a slippage limit", () => {
    const [a] = honestAttempts();
    expect(honestAttempts()).toHaveLength(1);
    expect(a.target).toBe(SWAP_TARGET);
    expect(a.minAmountOut).not.toBe("0");
  });
  it("the whole-balance attempt uses the vault balance it is given", () => {
    expect(injectedAttempts(BAL)[1].amount).toBe(BAL.toString());
  });
});

const att = (n: number): Attempt[] => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, intent: `try ${i}`, adapter: "swap", target: "t.testnet", amount: "1", minAmountOut: "0" }));
const refuse = (reason = "OVER_LIMIT"): SpendOutcome => ({ ok: false, reason, targetClass: "none", tx: "tx" });
const active: AgentNow = { status: "Active", autoDisabled: false };
const paused: AgentNow = { status: "Paused", autoDisabled: true };

describe("run loop", () => {
  it("AE1: ends 'auto_disabled' once the vault pauses the agent, and skips the rest", async () => {
    let calls = 0;
    const states: AgentNow[] = [active, active, active, active, paused];
    const r = await runAttempts({
      attempts: att(6),
      spend: async () => refuse(),
      readAgent: async () => states[Math.min(calls++, 4)],
      shouldStop: () => false,
      onStep: () => {},
    });
    expect(r.end).toBe("auto_disabled");
    expect(r.steps.map((s) => s.kind)).toEqual(["refused", "refused", "refused", "refused", "refused", "skipped"]);
    expect(r.agent).toEqual(paused);
  });
  it("an authorization failure is a failure and stops the run", async () => {
    let n = 0;
    const r = await runAttempts({
      attempts: att(4),
      spend: async () => {
        if (++n === 2) throw new Error("NotEnoughAllowance");
        return refuse();
      },
      readAgent: async () => active,
      shouldStop: () => false,
      onStep: () => {},
    });
    expect(r.end).toBe("failed");
    expect(r.steps.map((s) => s.kind)).toEqual(["refused", "failed", "skipped", "skipped"]);
    expect(n).toBe(2);
  });
  it("Stop sends no further attempt after the current one", async () => {
    let sent = 0;
    let stop = false;
    const r = await runAttempts({
      attempts: att(4),
      spend: async () => {
        sent++;
        stop = true; // pressed while the first attempt is in flight
        return refuse();
      },
      readAgent: async () => active,
      shouldStop: () => stop,
      onStep: () => {},
    });
    expect(sent).toBe(1);
    expect(r.end).toBe("stopped");
    expect(r.steps.map((s) => s.kind)).toEqual(["refused", "skipped", "skipped", "skipped"]);
  });
  it("a settled honest swap completes the run", async () => {
    const r = await runAttempts({ attempts: honestAttempts(), spend: async () => ({ ok: true, tx: "h" }), readAgent: async () => active, shouldStop: () => false, onStep: () => {} });
    expect(r.end).toBe("completed");
    expect(r.steps[0]).toEqual({ kind: "settled", tx: "h" });
  });
  it("reports each step as it moves: sending, then its outcome", async () => {
    const seen: string[] = [];
    await runAttempts({ attempts: att(1), spend: async () => refuse(), readAgent: async () => active, shouldStop: () => false, onStep: (i, s) => seen.push(`${i}:${s.kind}`) });
    expect(seen).toEqual(["0:sending", "0:refused"]);
  });
});

describe("interrupted-run marker", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  it("is set while a run is in flight and cleared when it ends", () => {
    const s = mem();
    expect(wasInterrupted(s, "v.testnet", "ed25519:A")).toBe(false);
    markRunStarted(s, "v.testnet", "ed25519:A");
    expect(wasInterrupted(s, "v.testnet", "ed25519:A")).toBe(true);
    markRunEnded(s, "v.testnet", "ed25519:A");
    expect(wasInterrupted(s, "v.testnet", "ed25519:A")).toBe(false);
  });
  it("storage that is blocked never throws", () => {
    expect(wasInterrupted(null, "v", "k")).toBe(false);
    expect(() => markRunStarted(null, "v", "k")).not.toThrow();
  });
});

const agent = (o: Partial<AgentView> = {}): AgentView => ({
  publicKey: "ed25519:A", label: "bot", status: "Active", autoDisabled: false,
  policy: { maxPerTx: "1", dailyCap: "1", maxSlippageBps: 100, allowedTargets: [SWAP_TARGET], maxRiskClass: "local_upgradeable" },
  usage: null, key: null, cannot: [], ...o,
});
const view = (targets: string[]): VaultView => ({
  vault: "v.testnet", owner: "o.testnet", operator: null, ceiling: { maxPerTx: "1", dailyTotal: "1", maxRiskClass: "local_upgradeable", allowedTargets: targets, agentAllowance: "1" },
  exposure: null, fullAccessKeys: 0, agents: [], unknownKeys: [], operatorCannot: [],
});
const checks = (o: { agent?: AgentView | null; held?: string[]; targets?: string[]; balance?: bigint | null }) =>
  preRunChecks({ vault: "v.testnet", view: view(o.targets ?? [SWAP_TARGET]), agent: o.agent === undefined ? agent() : o.agent, held: o.held ?? ["ed25519:A"], swapTarget: SWAP_TARGET, balance: o.balance === undefined ? BAL : o.balance, attempts: injectedAttempts(BAL) });

describe("checks before a run", () => {
  it("all pass for an active agent with its key, a swap target in the ceiling and funds", () => {
    expect(allPass(checks({}))).toBe(true);
  });
  it("no agent is offered without its key in this browser", () => {
    const c = checks({ held: [] });
    expect(allPass(c)).toBe(false);
    expect(c.find((x) => x.id === "key")?.reason).toMatch(/doesn.t hold/);
  });
  it("a missing swap target blocks the run, with a fix link", () => {
    const c = checks({ targets: ["drift-target.arunafi.testnet"] });
    const t = c.find((x) => x.id === "target");
    expect(t?.ok).toBe(false);
    expect(t?.fix?.href).toContain("/console/agents/");
  });
  it("an agent whose own list lacks the swap blocks the run, because the vault would refuse even the honest swap", () => {
    const c = checks({ agent: agent({ policy: { ...agent().policy, allowedTargets: ["drift-target.arunafi.testnet"] } }) });
    const t = c.find((x) => x.id === "agentTarget");
    expect(allPass(c)).toBe(false);
    expect(t?.reason).toContain("isn't allowed to use the swap contract");
    expect(t?.fix?.href).toContain("/console/agents/detail?agent=");
  });
  it("a paused or auto-disabled agent blocks the run", () => {
    expect(allPass(checks({ agent: agent({ status: "Paused", autoDisabled: true }) }))).toBe(false);
  });
  it("too little balance blocks the run and says how much is needed", () => {
    const c = checks({ balance: nearToYocto(0.1) });
    expect(c.find((x) => x.id === "balance")?.reason).toMatch(/needs about/);
    expect(allPass(checks({ balance: null }))).toBe(false);
  });
});
