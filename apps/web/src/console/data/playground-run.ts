import type { Attempt } from "./playground-scenarios";

// The playground's run loop (plan U7). It takes the agent's spend and a read of the agent's state as arguments, so the
// loop is tested without a wallet or a chain. Attempts go one at a time. A refusal returns and is recorded; an
// authorization failure (an exhausted allowance, a key the vault no longer has) is a failure and ends the run.

export type StepState =
  | { kind: "queued" }
  | { kind: "sending" }
  | { kind: "settled"; tx: string }
  | { kind: "refused"; reason: string; targetClass: string | null; tx: string }
  | { kind: "failed"; message: string }
  | { kind: "skipped" };

export interface SpendOutcome {
  ok: boolean;
  tx: string;
  reason?: string;
  targetClass?: string | null;
}

export interface AgentNow {
  status: "Active" | "Paused" | "Revoked";
  autoDisabled: boolean;
}

export type RunEnd = "completed" | "auto_disabled" | "stopped" | "failed";

export interface RunResult {
  end: RunEnd;
  steps: StepState[];
  agent: AgentNow | null;
}

/**
 * Runs the attempts in order. After each refusal it reads the agent again and stops when the vault has paused it
 * (`agent_auto_disabled`). `shouldStop` is checked before each attempt, so Stop never cancels one already sent.
 */
export async function runAttempts(o: {
  attempts: Attempt[];
  spend: (a: Attempt) => Promise<SpendOutcome>;
  readAgent: () => Promise<AgentNow | null>;
  shouldStop: () => boolean;
  onStep: (index: number, state: StepState) => void;
}): Promise<RunResult> {
  const steps: StepState[] = o.attempts.map(() => ({ kind: "queued" }));
  const set = (i: number, s: StepState) => {
    steps[i] = s;
    o.onStep(i, s);
  };
  let end: RunEnd = "completed";
  let agent: AgentNow | null = null;

  for (let i = 0; i < o.attempts.length; i++) {
    if (o.shouldStop()) {
      end = "stopped";
      break;
    }
    set(i, { kind: "sending" });
    let r: SpendOutcome;
    try {
      r = await o.spend(o.attempts[i]);
    } catch (e) {
      set(i, { kind: "failed", message: e instanceof Error ? e.message : "The call failed." });
      end = "failed";
      break;
    }
    if (r.ok) {
      set(i, { kind: "settled", tx: r.tx });
      continue;
    }
    set(i, { kind: "refused", reason: r.reason ?? "unknown", targetClass: r.targetClass ?? null, tx: r.tx });
    agent = await o.readAgent().catch(() => null);
    if (agent && (agent.autoDisabled || agent.status !== "Active")) {
      end = "auto_disabled";
      break;
    }
  }
  for (let i = 0; i < steps.length; i++) if (steps[i].kind === "queued") set(i, { kind: "skipped" });
  if (!agent) agent = await o.readAgent().catch(() => null);
  return { end, steps, agent };
}

export const END_TEXT: Record<RunEnd, string> = {
  completed: "The run finished.",
  auto_disabled: "The vault paused the agent after repeated refusals. Only the owner can resume it.",
  stopped: "You stopped the run before the next attempt.",
  failed: "The run stopped on a failure, not a refusal.",
};

// A run that was cut off by a reload leaves a marker, so the next visit can say so and show the real on-chain status.
const MARK = "aruna.playground.run";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const markKey = (vault: string, publicKey: string) => `${MARK}|${vault}|${publicKey}`;

export function markRunStarted(store: Store | null, vault: string, publicKey: string): void {
  try {
    store?.setItem(markKey(vault, publicKey), String(Date.now()));
  } catch {
    /* storage blocked: the interrupted notice is a convenience */
  }
}
export function markRunEnded(store: Store | null, vault: string, publicKey: string): void {
  try {
    store?.removeItem(markKey(vault, publicKey));
  } catch {
    /* ignore */
  }
}
export function wasInterrupted(store: Store | null, vault: string, publicKey: string): boolean {
  try {
    return store?.getItem(markKey(vault, publicKey)) != null;
  } catch {
    return false;
  }
}
