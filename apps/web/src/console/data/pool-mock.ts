import { coverageStore } from "./coverage-mock";
import type { Deposit } from "./pool";
import { withdrawable } from "./pool";

// SIMULATED. Two depositors, as in the prototype: the signed-in underwriter and one other. Their amounts add up to
// the pool capital the coverage store starts with.

export interface PoolState {
  deposits: Deposit[];
  capital: number;
}

export interface PoolStore {
  get(): PoolState;
  subscribe(l: () => void): () => void;
  deposit(account: string, amount: number, classes: Deposit["classes"]): void;
  withdraw(account: string, amount: number, pending: boolean): void;
}

const SEED: Deposit[] = [
  { id: "d-1", account: "underwriter.testnet", amount: 60_000, classes: ["immutable_verified", "local_upgradeable", "global_by_account"] },
  { id: "d-2", account: "capital-2.testnet", amount: 40_000, classes: ["immutable_verified", "local_upgradeable"] },
];

export function createPoolStore(coverage = coverageStore): PoolStore {
  let deposits = [...SEED];
  const listeners = new Set<() => void>();
  const state = (): PoolState => ({ deposits, capital: deposits.reduce((s, d) => s + d.amount, 0) });
  let snapshot = state();
  const emit = () => {
    snapshot = state();
    listeners.forEach((l) => l());
  };

  return {
    get: () => snapshot,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    deposit(account, amount, classes) {
      if (!(amount > 0)) throw new Error("ARUNA_AMOUNT_REQUIRED: enter an amount to deposit.");
      if (!classes.length) throw new Error("ARUNA_CLASS_REQUIRED: choose at least one risk class your capital may back.");
      deposits = [...deposits, { id: `d-${deposits.length + 1}`, account, amount, classes }];
      coverage.addCapital(amount);
      emit();
    },
    withdraw(account, amount, pending) {
      if (!(amount > 0)) throw new Error("ARUNA_AMOUNT_REQUIRED: enter an amount to withdraw.");
      const free = withdrawable(snapshot.capital, coverage.totalLimits(), pending).free;
      if (amount > free) throw new Error(`ARUNA_CAPITAL_LOCKED: only ${Math.round(free).toLocaleString("en-US")} USDC can leave the pool right now.`);
      const own = deposits.find((d) => d.account === account && d.amount >= amount);
      if (!own) throw new Error("ARUNA_NOT_YOUR_CAPITAL: you can only withdraw what you deposited.");
      deposits = deposits.map((d) => (d === own ? { ...d, amount: d.amount - amount } : d));
      coverage.addCapital(-amount);
      emit();
    },
  };
}

export const poolStore = createPoolStore();
