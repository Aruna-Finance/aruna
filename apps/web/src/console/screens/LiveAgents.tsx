"use client";

import Link from "next/link";
import { Button } from "@/shared/Button";
import { WithPlus } from "@/shared/WithPlus";
import { actorFor } from "../live-vault";
import { useLiveActions } from "../useLiveActions";
import type { LiveVault } from "../useLiveVault";
import { useRole } from "../RoleContext";
import { LiveAgentsTable } from "../ui/LiveAgentsTable";
import { Panel } from "../ui/Panel";
import { useWallet } from "../WalletContext";
import { relationOf } from "../walletRole";
import { PageHeader } from "../ui/PageHeader";

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
      <PageHeader
        title="Agents"
        relation={relation}
        extra={relation === "owner" && actor === "operator" && "You are viewing it as the operator, so owner-only actions are disabled."}
        actions={
          <>
            <Button type="button" variant="outline" onClick={refresh}>
              Refresh
            </Button>
            <Link href={`/console/agents/new/?vault=${encodeURIComponent(vault)}`} tabIndex={-1}>
              <Button type="button"><WithPlus>Create an agent</WithPlus></Button>
            </Link>
          </>
        }
      >
        Agents that can spend from <span className="mono break-all">{vault}</span>.
      </PageHeader>

      <div className="mt-6">
        <Panel title={`Agents (${view.agents.length})`}>
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
      </div>

      <p className="mt-6 text-sm text-muted">
        Funds, the operator and the vault limits are on the{" "}
        <Link href={`/console/vault/detail/?vault=${encodeURIComponent(vault)}`} className="underline underline-offset-4">
          Vault page
        </Link>
        .
      </p>
      <p className="mt-3 text-sm text-muted">
        <Link href={`/console/lookup/?vault=${encodeURIComponent(vault)}`} className="underline underline-offset-4">
          See this vault as others see it
        </Link>
      </p>
    </article>
  );
}
