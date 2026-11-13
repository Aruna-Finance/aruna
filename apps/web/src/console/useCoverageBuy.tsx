"use client";

import { OwnerCoverage, type BuyRequest, type BuyResult } from "@aruna/sdk/coverage";
import { useMemo } from "react";
import { createTestnetReads } from "./chain-reads";
import type { Watch } from "./data/coverage-buy";
import { POOL, REGISTRY } from "./data/price";
import { defaultHistory } from "./history";
import { useTx } from "./TxContext";
import { useWallet } from "./WalletContext";
import { createWalletTransport } from "./wallet-transport";

const GAS_BUY = "200000000000000";

/** The attestor assigned to a target and whether its heartbeat is fresh, from the registry. */
export async function readWatch(target: string): Promise<Watch> {
  const reads = createTestnetReads();
  const [attestor, fresh] = await Promise.all([
    reads.view<string | null>(REGISTRY, "assigned_attestor", { target }),
    reads.view<boolean>(REGISTRY, "heartbeat_fresh", { target }),
  ]);
  return { attestor, fresh };
}

/**
 * Buys coverage as the connected owner. The dialog is the preview: it shows the premium as the attached deposit before the
 * wallet opens. The pool charges its own quote and returns the rest, so what is attached is a ceiling the owner accepts.
 */
export function useCoverageBuy(vault: string, onDone: (r: Extract<BuyResult, { ok: true }>) => void) {
  const { accountId, getWallet } = useWallet();
  const { open } = useTx();
  const reads = useMemo(() => createTestnetReads(), []);
  const history = useMemo(() => defaultHistory(), []);

  return function buy(o: { request: BuyRequest; maxPremiumYocto: string; actions: string[] }) {
    if (!accountId) return;
    open({
      title: "Buy this coverage?",
      signer: accountId,
      receiver: POOL,
      method: "buy_coverage",
      depositYocto: o.maxPremiumYocto,
      gas: GAS_BUY,
      actions: o.actions,
      note: "Coverage starts after a waiting period; a change before that pays nothing. The pool charges its own quote and returns anything you attached above it. Only the vault's owner can buy.",
      okLabel: "Buy this coverage",
      onOk: async () => {
        const wallet = await getWallet();
        if (!wallet) throw new Error("Connect a wallet first.");
        const transport = createWalletTransport({ wallet, signerId: accountId, ...reads });
        const r = await new OwnerCoverage({ pool: POOL, transport }).buy({ request: o.request, token: "near", maxPremium: o.maxPremiumYocto });
        history.track({ hash: r.tx, vault, label: "Buy coverage" });
        if (r.ok) onDone(r);
        return r;
      },
    });
  };
}

