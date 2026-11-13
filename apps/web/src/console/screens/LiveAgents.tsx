"use client";

import Link from "next/link";
import { Button } from "@/shared/Button";
import { actorFor } from "../live-vault";
import { useLiveActions } from "../useLiveActions";
import type { LiveVault } from "../useLiveVault";
import { useRole } from "../RoleContext";
import { LiveVaultSettings } from "./LiveVaultSettings";
import { LiveAgentsTable } from "../ui/LiveAgentsTable";
import { Panel } from "../ui/Panel";
import { useWallet } from "../WalletContext";
import { relationOf, RELATION_TEXT } from "../walletRole";

/** The agents of a real vault: read from the chain, changed through the wallet. */
export function LiveAgents({ live }: { live: Extract<LiveVault, { status: "ok" }> }) {
  const { accountId } = useWallet();
  const { role } = useRole();
  const { view, held, refresh, vault } = live;
  const acts = useLiveActions(vault, refresh);
  const relation = relationOf(accountId, view);
  const actor = actorFor(relation, role);

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-[clamp(28px,4vw,44px)]">Agents</h1>
          <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
            Agents that can spend from <span className="mono break-all">{vault}</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={refresh}>
            Refresh
          </Button>
          <Link href={`/console/agents/new/?vault=${encodeURIComponent(vault)}`} tabIndex={-1}>
            <Button type="button">Create an agent</Button>
          </Link>
        </div>
      </div>

      <p className="mt-6 border-l-[3px] border-line-2 bg-fog px-5 py-3 text-[15px] leading-[1.6]">
        {relation ? RELATION_TEXT[relation] : "Connect a wallet to act on this vault. You can read it without one."}
        {relation === "owner" && actor === "operator" && " You are viewing it as the operator, so owner-only actions are disabled."}
      </p>

      <Panel className="mt-6" title={`Agents (${view.agents.length})`}>
        <LiveAgentsTable
          agents={view.agents}
          held={held}
          actor={actor}
          blockedReason=""
          onPause={(a) => acts.pause(a.publicKey, a.label)}
          onResume={(a) => acts.resume(a.publicKey, a.label)}
          onRevoke={(a) => acts.revoke(a.publicKey, a.label)}
        />
      </Panel>

      <LiveVaultSettings live={live} actor={actor} blockedReason="" />

      <p className="mt-6 text-sm text-muted">
        <Link href={`/console/lookup/?vault=${encodeURIComponent(vault)}`} className="underline underline-offset-4">
          Open this vault in Lookup
        </Link>
      </p>
    </article>
  );
}
