import { readVault } from "@aruna/sdk";
import { COVERAGE_ASSUME } from "./coverage";
import { coverageStore, quoteCoverage } from "./coverage-mock";
import { claimsStore } from "./claims-mock";
import { mockTargets } from "./mock";
import { vaultStore } from "./vault-mock";
import { policyPrice } from "./story-pricing";
import { n0, n2 } from "../fmt";

// The guided demo. Each step runs against the same mock stores the screens read, so a visitor can leave at any
// point and look. The one exception is the injected agent: that step reads a real testnet vault. Nothing here
// runs the vault's policy checks in the browser (CLAUDE.md rule 10), which is why the prototype's "send a swap"
// step is not carried over.

export const DEMO_VAULT = "demo2.factory.arunafi.testnet";
export const DEMO_AGENT = "treasury-agent";

export interface StoryStep {
  id: string;
  title: string;
  text: string;
  button: string;
  /** The console screen that shows what the step changed. */
  go: string;
  /** Marks a step that reads the real testnet instead of the mock. */
  live?: boolean;
  run(): Promise<string>;
}

type Reader = typeof readVault;

export function createSteps(read: Reader = readVault): StoryStep[] {
  return [
    {
      id: "check",
      title: "Classify a contract with no account",
      text: "Read any account's class and evidence. No wallet, no vault.",
      button: "Classify router.testnet",
      go: "/console/targets/detail/?id=router.testnet",
      run: async () => {
        const t = await mockTargets.get("router.testnet");
        if (!t) throw new Error("router.testnet is not in the target list.");
        return `router.testnet is ${t.classification.class}. A monitor watching its code_hash cannot see the owner redeploy.`;
      },
    },
    {
      id: "create",
      title: "The operator adds an agent for its client",
      text: "One labelled function-call key, within the ceiling the client set. The operator cannot loosen limits or take the funds.",
      button: "Add the key",
      go: "/console/agents/",
      run: async () => {
        if (!vaultStore.get().agents.some((a) => a.id === DEMO_AGENT)) {
          vaultStore.addAgent(
            {
              id: DEMO_AGENT,
              label: "Client treasury agent",
              policy: { maxPerTx: 50, dailyCap: 100, maxSlippageBps: 50, allowedTargets: ["vault.testnet", "dex.testnet"], maxRiskClass: "local_upgradeable" },
              deposit: 500,
              allowanceNear: 0.1,
            },
            "operator",
          );
        }
        return `The vault added the key, and ${vaultStore.get().vault} still has no full-access key.`;
      },
    },
    {
      id: "inject",
      title: "A prompt-injected agent gets disabled",
      text: "Poisoned context tells an agent to drain funds. The key and the vault refuse, and weighted refusals disable it. This step reads the real testnet vault, where that run already happened.",
      button: "Read the injected agent",
      go: `/console/lookup/?vault=${DEMO_VAULT}`,
      live: true,
      run: async () => {
        const v = await read(DEMO_VAULT, { network: "testnet" });
        const a = v.agents.find((x) => x.label === "injected");
        if (!a) return `${DEMO_VAULT} has no agent labelled injected right now. Run examples/injected-agent.ts to create the run.`;
        return `On ${DEMO_VAULT}, agent injected is ${a.autoDisabled ? "auto-disabled" : a.status}. The vault has ${v.fullAccessKeys} full-access keys, so the only way out was the vault's own policy.`;
      },
    },
    {
      id: "tighten",
      title: "Tighten the policy and see the price fall",
      text: "Halve the daily cap. The most the agent can lose shrinks, so the premium does too.",
      button: "Halve the daily cap",
      go: "/console/dashboard/",
      run: async () => {
        const list = await mockTargets.list();
        const classOf = (t: string) => list.find((x) => x.id === t)?.classification.class;
        const a = vaultStore.get().agents.find((x) => x.id === DEMO_AGENT);
        if (!a) throw new Error("Add the agent first.");
        const before = policyPrice(a.policy, classOf);
        vaultStore.applyPolicy(a.id, { ...a.policy, dailyCap: Math.round(a.policy.dailyCap / 2) }, "owner");
        const next = vaultStore.get().agents.find((x) => x.id === DEMO_AGENT)!;
        const after = policyPrice(next.policy, classOf);
        return before.priced && after.priced
          ? `The 30-day premium fell from ${n2(before.total)} to ${n2(after.total)} USDC.`
          : "The policy is tighter. A target in it is unknown, so no premium exists to compare.";
      },
    },
    {
      id: "buy",
      title: "The client buys coverage, and waits",
      text: "Coverage on vault.testnet starts in its waiting period, so a change before then pays nothing.",
      button: "Buy coverage",
      go: "/console/coverage/",
      run: async () => {
        const list = await mockTargets.list();
        const cls = list.find((x) => x.id === "vault.testnet")?.classification.class;
        const a = vaultStore.get().agents.find((x) => x.id === DEMO_AGENT);
        if (!a) throw new Error("Add the agent first.");
        const quote = quoteCoverage({
          cls,
          dailyCap: a.policy.dailyCap,
          slippagePct: a.policy.maxSlippageBps / 100,
          limit: 100,
          days: 30,
          payoutBps: COVERAGE_ASSUME.defaultPayoutBps,
          utilization: coverageStore.utilization(),
        });
        const p = coverageStore.buy({ agent: a.id, target: "vault.testnet", limit: 100, days: 30, payoutBps: COVERAGE_ASSUME.defaultPayoutBps }, quote);
        return `Policy ${p.id} bought for ${n2(p.premiumPaid)} USDC. It is in its ${COVERAGE_ASSUME.waitingPeriodSec / 86_400}-day waiting period.`;
      },
    },
    {
      id: "report",
      title: "An attestor reports drift on dex.testnet",
      text: "The target's owner shipped new code. The agent stayed within policy, so limits alone do not catch this. The attestor reports it and a challenge window opens.",
      button: "Send the report",
      go: "/console/claims/",
      run: async () => {
        const r = claimsStore.reportDrift("dex.testnet");
        const n = claimsStore.get().claims.filter((c) => c.report === r.id).length;
        return `Report ${r.id} is open with ${n} claims on it. No payout happens until the challenge window closes.`;
      },
    },
    {
      id: "payout",
      title: "The window closes and the claim pays",
      text: "The amount follows the formula min(recorded exposure x payout ratio, limit). It is the formula's output, not a measured loss.",
      button: "Skip the challenge window",
      go: "/console/claims/",
      run: async () => {
        claimsStore.advance(COVERAGE_ASSUME.challengeWindowSec + 1);
        const c = claimsStore.get().claims.find((x) => x.target === "dex.testnet" && x.agent === "rebalancer");
        if (!c) return "The window closed.";
        return c.status === "paid"
          ? `min(${n0(c.exposure)} x ${c.payoutBps / 100}%, ${n0(c.limit)}) = ${n0(c.payout)} USDC paid from the pool.`
          : `The claim for rebalancer is ${c.status}${c.rejectReason ? `: ${c.rejectReason}` : ""}.`;
      },
    },
    {
      id: "false",
      title: "A false report goes to the arbiter",
      text: "An attestor reports a vault change that never happened. A second attestor conflicts, payout stops, and the arbiter rules.",
      button: "Report, conflict, rule",
      go: "/console/claims/",
      run: async () => {
        const r = claimsStore.reportDrift("vault.testnet");
        claimsStore.conflict(r.id, "attestor-2.testnet", "J2gKRtjUyQn4oS9wX1bZvH3mPaCdE5fL7uYtNq8RkWgB");
        claimsStore.rule(r.id, false);
        return `The arbiter rejected report ${r.id}. The bond was slashed and the claims rejected. The arbiter is a second trust assumption.`;
      },
    },
  ];
}

export interface StoryState {
  done: Record<string, string>;
  error: string | null;
  busy: boolean;
}

export function createStoryStore(steps: StoryStep[] = createSteps()) {
  let state: StoryState = { done: {}, error: null, busy: false };
  const listeners = new Set<() => void>();
  const set = (next: StoryState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  return {
    steps,
    get: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** The next step is the first one not done. Steps run in order. */
    nextIndex: () => steps.findIndex((s) => !(s.id in state.done)),
    async run(id: string) {
      const step = steps.find((s) => s.id === id);
      if (!step || state.busy || steps[this.nextIndex()]?.id !== id) return;
      set({ ...state, busy: true, error: null });
      try {
        const text = await step.run();
        set({ done: { ...state.done, [id]: text }, error: null, busy: false });
      } catch (e) {
        set({ ...state, busy: false, error: e instanceof Error ? e.message : "The step failed." });
      }
    },
  };
}

export const storyStore = createStoryStore();
