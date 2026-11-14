"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@/shared/Button";
import { WithPlus } from "@/shared/WithPlus";
import { defaultHistory } from "../history";
import { useWallet } from "../WalletContext";
import { MyVaults } from "./CreateVault";
import { PageHeader } from "../ui/PageHeader";

/** Every vault the connected account owns or operates, one row each. A row opens that vault. */
export function VaultList() {
  const { accountId, connect, status } = useWallet();
  const history = useMemo(() => defaultHistory(), []);
  return (
    <article>
      <PageHeader
        title="Vaults"
        actions={
          <Link href="/console/create/" tabIndex={-1}>
            <Button type="button"><WithPlus>Create vault</WithPlus></Button>
          </Link>
        }
      >
        A vault holds the money your agents spend. Open one to manage its funds, operator and limits.
      </PageHeader>
      <div className="mt-8">
        {accountId ? (
          <MyVaults account={accountId} history={history} to="/console/vault/detail/" table />
        ) : (
          <div>
            <p className="max-w-[70ch] text-[15px] leading-[1.6] text-slate">Connect your wallet to see the vaults you own or operate.</p>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button type="button" disabled={status === "connecting"} onClick={() => void connect()}>
                {status === "connecting" ? "Connecting" : "Connect wallet"}
              </Button>
              <Link href="/console/create/" className="text-[15px] underline underline-offset-4">
                New here? Create a vault
              </Link>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
