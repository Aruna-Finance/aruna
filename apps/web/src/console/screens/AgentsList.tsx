"use client";

import Link from "next/link";
import { Button } from "@/shared/Button";
import { useActions } from "../useActions";
import { AgentsTable } from "../ui/AgentsTable";
import { Panel } from "../ui/Panel";

export function AgentsList() {
  const { vault, isOperator, freeze, resume } = useActions();

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-[clamp(28px,4vw,44px)]">Agents</h1>
          <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
            Each agent is a labelled function-call key on <span className="mono">{vault.vault}</span>. It has no account
            and holds no funds. Revoking one deletes its key.
          </p>
        </div>
        <Link href="/console/agents/new/" tabIndex={-1}>
          <Button type="button">Create an agent</Button>
        </Link>
      </div>

      <Panel className="mt-8">
        <AgentsTable agents={vault.agents} isOperator={isOperator} onFreeze={freeze} onResume={resume} />
      </Panel>
    </article>
  );
}
