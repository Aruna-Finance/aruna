"use client";

import { OwnerCoverage } from "@aruna/sdk/coverage";
import { useMemo } from "react";
import { createTestnetReads } from "./chain-reads";
import { POOL } from "./data/price";
import { defaultHistory } from "./history";
import { useTx } from "./TxContext";
import { useWallet } from "./WalletContext";
import { createWalletTransport } from "./wallet-transport";

const GAS_CLAIM = "200000000000000";

/**
 * Starts a claim on a coverage against a verified report. Anyone may start one and the payout goes to the coverage's owner.
 * A claim the pool rejects comes back as an outcome with its reason; too little gas or a claim already running is a failure.
 */
export function useClaimAction(vault: string, onDone: () => void) {
  const { accountId, getWallet } = useWallet();
  const { open } = useTx();
  const reads = useMemo(() => createTestnetReads(), []);
  const history = useMemo(() => defaultHistory(), []);

  return function claim(o: { coverageId: number; reportId: number; target: string }) {
    if (!accountId) return;
    open({
      title: "Start this claim?",
      signer: accountId,
      receiver: POOL,
      method: "claim",
      depositYocto: "0",
      gas: GAS_CLAIM,
      actions: [`Claim on coverage #${o.coverageId}`, `For the code change in report ${o.reportId} on ${o.target}`],
      note: "The pool checks the report, the waiting period, the challenge window and the recorded exposure, and pays the coverage's owner only if every one holds. A claim inside the challenge window is refused and recorded.",
      okLabel: "Start the claim",
      onOk: async () => {
        const wallet = await getWallet();
        if (!wallet) throw new Error("Connect a wallet first.");
        const transport = createWalletTransport({ wallet, signerId: accountId, ...reads });
        const r = await new OwnerCoverage({ pool: POOL, transport }).claim({ coverageId: o.coverageId, reportId: o.reportId });
        history.track({ hash: r.tx, vault, label: "Start claim" });
        onDone();
        return r;
      },
    });
  };
}
