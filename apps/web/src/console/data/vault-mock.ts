import { ceilingProblem, isTightening, type AgentRecord, type AgentStatus, type NewAgent, type Policy, type VaultActor, type VaultEvent, type VaultState, type VaultStore } from "./vault";

// SIMULATED. Seed follows the prototype's mock data (budi.testnet's vault with three agents).

const BLOCK = 241_800_000;

const agent = (a: Omit<AgentRecord, "autoDisabled" | "allowanceNear" | "addedBlock"> & { addedAgo: number }): AgentRecord => {
  const { addedAgo, ...rest } = a;
  return { ...rest, autoDisabled: false, allowanceNear: 0.25, addedBlock: BLOCK - addedAgo };
};

const seed = (): VaultState => ({
  vault: "vault-budi.aruna.testnet",
  owner: "budi.testnet",
  operator: "opsdesk.testnet",
  version: "v1",
  latestVersion: "v2",
  ceiling: { maxPerTx: 250, dailyTotal: 1500 },
  block: BLOCK,
  agents: [
    agent({
      id: "rebalancer",
      label: "Treasury rebalancer",
      publicKey: "ed25519:sim-rebalancer",
      status: "Active",
      policy: { maxPerTx: 50, dailyCap: 100, maxSlippageBps: 50, allowedTargets: ["vault.testnet", "dex.testnet"], maxRiskClass: "local_upgradeable" },
      spentToday: 62,
      reserved: 0,
      exposure: { "dex.testnet": 400, "vault.testnet": 180 },
      coveredLimit: 500,
      balance: 1200,
      addedAgo: 900_000,
    }),
    agent({
      id: "market-maker",
      label: "Market maker",
      publicKey: "ed25519:sim-market-maker",
      status: "Active",
      policy: { maxPerTx: 200, dailyCap: 800, maxSlippageBps: 100, allowedTargets: ["vault.testnet", "dex.testnet", "router.testnet"], maxRiskClass: "global_by_account" },
      spentToday: 310,
      reserved: 40,
      exposure: { "dex.testnet": 1250, "router.testnet": 2100, "vault.testnet": 640 },
      coveredLimit: 2400,
      balance: 5400,
      addedAgo: 700_000,
    }),
    agent({
      id: "yield-runner",
      label: "Client yield runner",
      publicKey: "ed25519:sim-yield-runner",
      status: "Paused",
      policy: { maxPerTx: 20, dailyCap: 60, maxSlippageBps: 30, allowedTargets: ["vault.testnet"], maxRiskClass: "immutable_verified" },
      spentToday: 0,
      reserved: 0,
      exposure: { "vault.testnet": 90 },
      coveredLimit: 200,
      balance: 300,
      addedAgo: 300_000,
    }),
  ],
  events: [
    { id: 7, type: "execution_rejected", block: BLOCK - 640, agent: "market-maker", target: "dex.testnet", code: "SLIPPAGE_TOO_HIGH", detail: "swap 150 USDC at 4.00% slippage" },
    { id: 6, type: "execution_allowed", block: BLOCK - 3_100, agent: "rebalancer", target: "dex.testnet", detail: "swap 32 USDC" },
    { id: 5, type: "execution_rejected", block: BLOCK - 9_200, agent: "rebalancer", target: "bridge.testnet", code: "TARGET_NOT_ALLOWED", detail: "swap 40 USDC" },
    { id: 4, type: "execution_allowed", block: BLOCK - 41_000, agent: "market-maker", target: "router.testnet", detail: "swap 120 USDC" },
    { id: 3, type: "exposure_recorded", block: BLOCK - 160_000, agent: "rebalancer", target: "dex.testnet", detail: "Exposure 400 USDC" },
    { id: 2, type: "coverage_purchased", block: BLOCK - 691_000, agent: "rebalancer", target: "dex.testnet", detail: "Limit 500 USDC, 80% payout, 30 days" },
    { id: 1, type: "agent_registered", block: BLOCK - 900_000, agent: "rebalancer" },
  ],
});

export function createVaultStore(): VaultStore {
  let state = seed();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const push = (e: Omit<VaultEvent, "id" | "block">) => {
    const id = Math.max(0, ...state.events.map((x) => x.id)) + 1;
    return [{ ...e, id, block: state.block }, ...state.events];
  };
  const edit = (id: string, f: (a: AgentRecord) => AgentRecord) =>
    state.agents.map((a) => (a.id === id ? f(a) : a));

  return {
    get: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setAgentStatus(id: string, status: AgentStatus, by: VaultActor) {
      // The vault refuses an operator that tries to resume (docs: operator cannot resume).
      if (status === "Active" && by === "operator") throw new Error("ARUNA_NOT_OWNER: only the owner can resume an agent.");
      state = {
        ...state,
        agents: edit(id, (a) => ({ ...a, status, autoDisabled: status === "Active" ? false : a.autoDisabled })),
        events: push({ type: "agent_status_changed", agent: id, detail: `Status is now ${status}` }),
      };
      emit();
    },
    applyPolicy(id: string, policy: Policy, by: VaultActor) {
      const cur = state.agents.find((a) => a.id === id);
      if (!cur) throw new Error(`Unknown agent ${id}`);
      if (by === "operator" && !isTightening(cur.policy, policy)) throw new Error("ARUNA_NOT_OWNER: an operator can only tighten a policy.");
      const problem = ceilingProblem(state, policy, id);
      if (problem) throw new Error(`ARUNA_CEILING_EXCEEDED: ${problem}`);
      state = { ...state, agents: edit(id, (a) => ({ ...a, policy })), events: push({ type: "policy_updated", agent: id }) };
      emit();
    },
    addAgent(input: NewAgent, by: VaultActor) {
      void by; // both the owner and the operator may add agents within the ceiling
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.id) || state.agents.some((a) => a.id === input.id)) {
        throw new Error("ARUNA_INVALID_AGENT_ID: use lower-case letters, digits and hyphens, and an id that is not taken.");
      }
      const problem = ceilingProblem(state, input.policy);
      if (problem) throw new Error(`ARUNA_CEILING_EXCEEDED: ${problem}`);
      const created: AgentRecord = {
        id: input.id,
        label: input.label,
        publicKey: `ed25519:sim-${input.id}`,
        status: "Active",
        autoDisabled: false,
        policy: input.policy,
        spentToday: 0,
        reserved: 0,
        exposure: {},
        coveredLimit: 0,
        balance: input.deposit,
        allowanceNear: input.allowanceNear,
        addedBlock: state.block,
      };
      state = { ...state, agents: [...state.agents, created], events: push({ type: "agent_registered", agent: input.id }) };
      emit();
      return created;
    },
    deposit(id, amount) {
      if (!(amount > 0)) throw new Error("Enter an amount above zero.");
      state = { ...state, agents: edit(id, (a) => ({ ...a, balance: a.balance + amount })), events: push({ type: "deposit_recorded", agent: id, detail: `Deposit ${amount} USDC` }) };
      emit();
    },
    withdraw(id, amount, by) {
      if (by === "operator") throw new Error("ARUNA_NOT_OWNER: only the owner can withdraw, and only to its own account.");
      const cur = state.agents.find((a) => a.id === id);
      if (!cur) throw new Error(`Unknown agent ${id}`);
      if (!(amount > 0)) throw new Error("Enter an amount above zero.");
      if (amount > cur.balance) throw new Error("ARUNA_INSUFFICIENT_BALANCE: the vault holds less than that for this agent.");
      state = { ...state, agents: edit(id, (a) => ({ ...a, balance: a.balance - amount })), events: push({ type: "withdrawn", agent: id, detail: `${amount} USDC to ${state.owner}` }) };
      emit();
    },
    setAllowance(id, near, by) {
      if (by === "operator") throw new Error("ARUNA_NOT_OWNER: only the owner can raise an allowance.");
      if (!(near > 0)) throw new Error("Enter an allowance above zero.");
      state = { ...state, agents: edit(id, (a) => ({ ...a, allowanceNear: near })), events: push({ type: "allowance_set", agent: id, detail: `${near} NEAR` }) };
      emit();
    },
    setOperator(account) {
      state = {
        ...state,
        operator: account,
        events: push({ type: "operator_changed", detail: account ? `Operator is ${account}` : "Operator removed" }),
      };
      emit();
    },
  };
}

/** One store for the browser session; a fresh one per test. */
export const vaultStore = createVaultStore();
