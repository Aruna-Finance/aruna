"use client";

import Link from "next/link";
import { useState } from "react";
import { actorFor, noActorReason } from "../live-vault";
import { useLiveVault, type LiveVault } from "../useLiveVault";
import { useRole } from "../RoleContext";
import { useWallet } from "../WalletContext";
import { relationOf } from "../walletRole";
import { NoVault } from "../ui/NoVault";
import { Tabs } from "../ui/Tabs";
import { VaultFunds } from "../ui/VaultFunds";
import { LiveVaultSettings } from "./LiveVaultSettings";
import { PageHeader } from "../ui/PageHeader";

const TABS = [
  { id: "funds" as const, label: "Funds" },
  { id: "operator" as const, label: "Operator" },
  { id: "limits" as const, label: "Limits" },
];

/** One vault, one task at a time: its funds, who operates it, the limits every agent lives under. */
export function Vault() {
  const live = useLiveVault();
  if (live.status !== "ok") return <NoVault live={live} title="Vault" />;
  return <LiveVaultPage live={live} />;
}

function LiveVaultPage({ live }: { live: Extract<LiveVault, { status: "ok" }> }) {
  const { accountId } = useWallet();
  const { role } = useRole();
  const { vault, view } = live;
  const relation = relationOf(accountId, view);
  const actor = actorFor(relation, role);
  const [tab, setTab] = useState<"funds" | "operator" | "limits">("funds");

  return (
    <article>
      <PageHeader
        title="Vault"
        relation={relation}
        extra={relation === "owner" && actor === "operator" && "You are viewing it as the operator, so owner-only actions are disabled."}
        lead={
          <Link href="/console/vault/" className="underline underline-offset-4">
            All vaults
          </Link>
        }
      >
        <span className="mono break-all">{vault}</span>
      </PageHeader>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">

        <Tabs tabs={TABS} value={tab} onChange={setTab}>
          {tab === "funds" && <VaultFunds live={live} actor={actor} reason={noActorReason(relation)} />}
          {tab === "operator" && <LiveVaultSettings live={live} actor={actor} blockedReason={noActorReason(relation)} only="operator" />}
          {tab === "limits" && <LiveVaultSettings live={live} actor={actor} blockedReason={noActorReason(relation)} only="limits" />}
        </Tabs>
      </div>
    </article>
  );
}
