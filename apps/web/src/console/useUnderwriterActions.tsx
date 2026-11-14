"use client";

import { fetchViewTransport, Pool, UNDERWRITER_GAS_TGAS } from "@aruna/sdk/coverage";
import { useMemo } from "react";
import { createTestnetReads } from "./chain-reads";
import { POOL } from "./data/price";
import { performDeposit, performWithdraw } from "./data/underwriter-run";
import { useTx } from "./TxContext";
import { useWallet } from "./WalletContext";
import { createWalletTransport } from "./wallet-transport";

const gasOf = (tgas: bigint) => (tgas * 10n ** 12n).toString();

/** What the confirmation shows: the lines under "What it does" and the note under them (the lock, or what a refusal means). */
export interface Review {
  actions: string[];
  note: string;
}

export interface UnderwriterActions {
  deposit(o: { token: string; label: string; amount: bigint; review: Review }): void;
  withdraw(o: { token: string; label: string; plan: { all: true } | { shares: bigint }; review: Review }): void;
}

export const NO_ACTIONS: UnderwriterActions = { deposit: () => {}, withdraw: () => {} };

/**
 * Deposit and withdraw as the connected underwriter. The dialog is the preview: it states the estimate, the lock and the
 * amounts before the wallet opens. These are the underwriter's own actions, never an agent key's, so they sign with the
 * wallet and are not part of any vault. `onDone` runs only when the pool took the action, to re-read the book.
 */
export function useUnderwriterActions(onDone: () => void): UnderwriterActions {
  const { accountId, getWallet } = useWallet();
  const { open } = useTx();
  const reads = useMemo(() => createTestnetReads(), []);

  async function transportFor(account: string) {
    const wallet = await getWallet();
    if (!wallet) throw new Error("Connect a wallet first.");
    return createWalletTransport({ wallet, signerId: account, ...reads });
  }

  return {
    deposit(o) {
      if (!accountId) return;
      const near = o.token === "near";
      open({
        title: `Deposit into the ${o.label} book?`,
        signer: accountId,
        receiver: near ? POOL : o.token,
        method: near ? "deposit" : "ft_transfer_call",
        depositYocto: near ? o.amount.toString() : "1",
        gas: gasOf(near ? UNDERWRITER_GAS_TGAS.deposit : UNDERWRITER_GAS_TGAS.depositFt),
        actions: o.review.actions,
        note: o.review.note,
        source: "pool",
        okLabel: "Deposit",
        onOk: async () => performDeposit({ transport: await transportFor(accountId), token: o.token, amount: o.amount, onDone }),
      });
    },
    withdraw(o) {
      if (!accountId) return;
      open({
        title: `Withdraw from the ${o.label} book?`,
        signer: accountId,
        receiver: POOL,
        method: "withdraw",
        depositYocto: "1",
        gas: gasOf(UNDERWRITER_GAS_TGAS.withdraw),
        actions: o.review.actions,
        note: o.review.note,
        source: "pool",
        okLabel: "Withdraw",
        onOk: async () => {
          const pool = new Pool({ pool: POOL, transport: fetchViewTransport({ network: "testnet" }) });
          return performWithdraw({
            transport: await transportFor(accountId),
            token: o.token,
            plan: o.plan,
            readHeld: async () => BigInt(await pool.shares(accountId, o.token)),
            onDone,
          });
        },
      });
    },
  };
}
