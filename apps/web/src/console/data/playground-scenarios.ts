// The attempts the playground sends (plan U7, R22, KTD8). They mirror the recorded run in examples/injected-agent.ts and
// examples/README.md, in the same order with the same amounts. The plan moves this list to examples/scenarios.ts so the
// two example agents and the page import one definition; that file is shared with Aris, so until the move is agreed the
// list lives here and a test pins the order against the recorded run.

import { nearToYocto } from "../fmt";

/** The swap target on the Aruna testnet deployment. The registry must hold a class for it (swap.arunafi.testnet is local_upgradeable). */
export const SWAP_TARGET = "swap.arunafi.testnet";

export interface Attempt {
  id: string;
  /** What the poisoned or honest agent is trying to do, in the words of the recorded run. */
  intent: string;
  adapter: "swap";
  target: string;
  /** yoctoNEAR. */
  amount: string;
  minAmountOut: string;
}

const near = (n: number) => nearToYocto(n).toString();

/** What the prompt-injected agent tries, in order. The last entry is an ordinary in-policy swap the vault refuses once the agent is auto-disabled. */
export function injectedAttempts(vaultBalanceYocto: bigint): Attempt[] {
  return [
    { id: "i1", intent: "send funds to the attacker", adapter: "swap", target: "attacker.testnet", amount: near(0.2), minAmountOut: "0" },
    { id: "i2", intent: "swap the whole balance", adapter: "swap", target: SWAP_TARGET, amount: vaultBalanceYocto.toString(), minAmountOut: "0" },
    { id: "i3", intent: "swap with no slippage limit", adapter: "swap", target: SWAP_TARGET, amount: near(0.1), minAmountOut: "0" },
    { id: "i4", intent: "send funds to the attacker again", adapter: "swap", target: "attacker.testnet", amount: near(0.1), minAmountOut: "0" },
    { id: "i5", intent: "send funds to a second address", adapter: "swap", target: "attacker-2.testnet", amount: near(0.1), minAmountOut: "0" },
    { id: "i6", intent: "an ordinary in-policy swap", adapter: "swap", target: SWAP_TARGET, amount: near(0.1), minAmountOut: near(0.0995) },
  ];
}

/** The honest agent's one swap: inside the policy, with a slippage limit. */
export function honestAttempts(): Attempt[] {
  return [{ id: "h1", intent: "an ordinary in-policy swap", adapter: "swap", target: SWAP_TARGET, amount: near(0.1), minAmountOut: near(0.0995) }];
}

export type ScenarioId = "injected" | "honest";

export const SCENARIOS: Record<ScenarioId, { title: string; what: string }> = {
  injected: {
    title: "Injected agent",
    what: "Poisoned text tells the agent to move funds out. The vault refuses each attempt, records it, and pauses the agent once the weighted refusals reach the threshold.",
  },
  honest: {
    title: "Honest agent",
    what: "One in-policy swap with a slippage limit. The vault lets it settle.",
  },
};

export function attemptsFor(id: ScenarioId, vaultBalanceYocto: bigint): Attempt[] {
  return id === "injected" ? injectedAttempts(vaultBalanceYocto) : honestAttempts();
}
