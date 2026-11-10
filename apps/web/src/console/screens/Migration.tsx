"use client";

import { useState } from "react";
import { Button } from "@/shared/Button";
import { Drawer } from "@/shared/Drawer";
import { vaultStore } from "../data/vault-mock";
import { useActions } from "../useActions";
import { Panel } from "../ui/Panel";

export function Migration() {
  const { vault, actor, isOperator, ask, run } = useActions();
  const [open, setOpen] = useState(false);
  const outdated = vault.codeHash !== vault.latestCodeHash;

  const steps = [
    {
      name: "Pause every agent",
      text: "Stops new spending without deleting keys, so nothing is in flight during the move.",
    },
    {
      name: "Create the new vault",
      text: `The factory deploys ${vault.latestCodeHash} by hash and registers it. It classifies itself before you fund it.`,
    },
    {
      name: "Move funds and re-register agents",
      text: "Each agent gets a new function-call key. Labels and policies carry over; public keys do not.",
    },
    {
      name: "Revoke the old keys and withdraw the remainder",
      text: "Delete the keys on the old vault, then withdraw to the owner.",
    },
  ];

  function migrate() {
    ask({
      title: "Migrate to the new vault?",
      receiver: "aruna.testnet",
      actions: [
        "pause agents",
        `factory: deploy ${vault.latestCodeHash} by hash`,
        "move funds, re-register agents with new keys",
        "delete old keys, withdraw the remainder",
      ],
      note: "Existing coverage stays with the old vault and runs to expiry.",
      okLabel: "Migrate vault",
      onOk: () => run(() => vaultStore.migrate(actor), "Migrated. Each agent has a new key on the new vault."),
    });
  }

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-[clamp(28px,4vw,44px)]">Migrate to a new vault</h1>
          <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
            This vault&apos;s code cannot be changed. That is what lets it classify itself as{" "}
            <span className="mono">immutable_verified</span>, and its cost is that a new version means a new vault.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            Versions
          </Button>
          {outdated && !isOperator && (
            <Button type="button" onClick={migrate}>
              Start the migration
            </Button>
          )}
        </div>
      </div>

      <Panel className="mt-8">
        {!outdated && (
          <p className="mb-5 border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm">
            You are on the latest version, <span className="mono">{vault.version}</span>. Nothing to migrate.
          </p>
        )}
        {isOperator && outdated && (
          <p className="mb-5 border-l-[3px] border-dawn bg-dawn-wash px-4 py-3 text-sm">
            Only the client can migrate the vault. Ask {vault.owner} to start it.
          </p>
        )}
        <ol className="grid gap-0">
          {steps.map((s, i) => (
            <li key={s.name} className="grid grid-cols-[2rem_1fr] gap-x-4 border-t border-line py-4 first:border-t-0 first:pt-0">
              <b
                className={`inline-flex size-7 items-center justify-center border text-xs ${outdated ? (i === 0 ? "border-ink bg-ink text-paper" : "border-line-2") : "border-ink"}`}
              >
                {i + 1}
              </b>
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="mt-1 max-w-[80ch] text-sm leading-[1.6] text-slate">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-[80ch] text-sm text-muted">
          Coverage does not transfer. Exposure recorded on the old vault stays attached to it, so leave existing coverage to run to expiry
          rather than cancelling it.
        </p>
      </Panel>

      <Drawer open={open} onClose={() => setOpen(false)} title="Versions">
        <dl className="grid gap-4 text-sm">
          <div>
            <dt className="text-muted">This vault</dt>
            <dd className="mono break-all">{vault.vault}</dd>
          </div>
          <div>
            <dt className="text-muted">Runs</dt>
            <dd className="mono break-all">
              {vault.version}, {vault.codeHash}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Latest</dt>
            <dd className="mono break-all">
              {vault.latestVersion}, {vault.latestCodeHash}
            </dd>
          </div>
        </dl>
        <p className="mt-5 text-sm">{outdated ? "A new version is available." : "You are on the latest version."}</p>
        <p className="mt-2 text-sm text-muted">You can always withdraw to the owner, in any state.</p>
      </Drawer>
    </article>
  );
}
