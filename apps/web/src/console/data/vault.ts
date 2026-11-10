import type { RiskClass } from "@/landing/lib/classifier-types";

// Mock vault state for the owner and operator screens. Shapes follow @aruna/sdk's VaultView (policy,
// usage, exposure per target, owner and operator); amounts here are whole USDC for display only.
// Nothing in this file decides anything: it holds a seeded snapshot and applies the owner's edits.

export type AgentStatus = "Active" | "Paused" | "Revoked";

export interface Policy {
  maxPerTx: number;
  dailyCap: number;
  maxSlippageBps: number;
  allowedTargets: string[];
  maxRiskClass: RiskClass;
}

export interface AgentRecord {
  id: string;
  label: string;
  publicKey: string;
  status: AgentStatus;
  autoDisabled: boolean;
  policy: Policy;
  spentToday: number;
  reserved: number;
  /** Recorded exposure per target: what was sent through the vault, not the value of a position. */
  exposure: Record<string, number>;
  /** Sum of the limits of the agent's active coverage policies. */
  coveredLimit: number;
  /** USDC held in the vault on this agent's behalf. The agent holds none. */
  balance: number;
  /** Classic gas allowance on the agent's function-call key, in NEAR. */
  allowanceNear: number;
  /** Block at which the agent was added. */
  addedBlock: number;
}

export interface NewAgent {
  id: string;
  label: string;
  policy: Policy;
  deposit: number;
  allowanceNear: number;
}

export interface Ceiling {
  maxPerTx: number;
  dailyTotal: number;
}

export interface VaultEvent {
  id: number;
  type: string;
  block: number;
  agent?: string;
  target?: string;
  /** Contract reason without the ARUNA_ prefix. */
  code?: string;
  detail?: string;
}

export interface VaultState {
  vault: string;
  owner: string;
  operator: string | null;
  version: string;
  latestVersion: string;
  codeHash: string;
  latestCodeHash: string;
  ceiling: Ceiling;
  agents: AgentRecord[];
  events: VaultEvent[];
  block: number;
}

export type VaultActor = "owner" | "operator";

export interface VaultStore {
  get(): VaultState;
  subscribe(listener: () => void): () => void;
  setAgentStatus(id: string, status: AgentStatus, by: VaultActor): void;
  applyPolicy(id: string, policy: Policy, by: VaultActor): void;
  setOperator(account: string | null): void;
  addAgent(input: NewAgent, by: VaultActor): AgentRecord;
  deposit(id: string, amount: number): void;
  /** Owner only, and only to the owner's account. */
  withdraw(id: string, amount: number, by: VaultActor): void;
  /** Owner only. */
  setAllowance(id: string, near: number, by: VaultActor): void;
  /** Owner only. Moves to a new vault; each live agent gets a new key. */
  migrate(by: VaultActor): void;
}

/** Why a policy cannot be saved under the owner's ceiling, or null. `skip` leaves one agent out of the daily total. */
export function ceilingProblem(state: VaultState, policy: Policy, skip?: string): string | null {
  if (policy.maxPerTx > state.ceiling.maxPerTx) {
    return `Max per transaction is above the owner's ceiling of ${state.ceiling.maxPerTx.toLocaleString("en-US")} USDC.`;
  }
  const others = state.agents.filter((a) => a.status !== "Revoked" && a.id !== skip).reduce((x, a) => x + a.policy.dailyCap, 0);
  if (others + policy.dailyCap > state.ceiling.dailyTotal) {
    return `Daily caps across all agents would pass the owner's ceiling of ${state.ceiling.dailyTotal.toLocaleString("en-US")} USDC.`;
  }
  return null;
}

/** An operator may only tighten: every limit lower or equal, no new target, no riskier class. */
export function isTightening(from: Policy, to: Policy): boolean {
  return (
    to.maxPerTx <= from.maxPerTx &&
    to.dailyCap <= from.dailyCap &&
    to.maxSlippageBps <= from.maxSlippageBps &&
    CLASS_RANK[to.maxRiskClass] <= CLASS_RANK[from.maxRiskClass] &&
    to.allowedTargets.every((t) => from.allowedTargets.includes(t))
  );
}

export const CLASS_RANK: Record<RiskClass, number> = {
  immutable_verified: 0,
  local_upgradeable: 1,
  global_by_account: 2,
  unknown: 3,
};
