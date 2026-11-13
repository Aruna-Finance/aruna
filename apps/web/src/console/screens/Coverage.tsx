"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/shared/Button";
import { Drawer } from "@/shared/Drawer";
import { useLiveVault, type LiveVault } from "../useLiveVault";
import { useTokenMeta } from "../useTokenMeta";
import { useVaultCoverage } from "../useVaultCoverage";
import { useWallet } from "../WalletContext";
import { relationOf } from "../walletRole";
import { LiveCoverageTable } from "../ui/LiveCoverageTable";
import { NotCovered } from "../ui/CoverageNotes";
import { NoVault } from "../ui/NoVault";
import { Panel } from "../ui/Panel";

export function Coverage() {
  const live = useLiveVault();
  if (live.status !== "ok") return <NoVault live={live} title="Coverage policies" />;
  return <LiveCoverage live={live} />;
}

function LiveCoverage({ live }: { live: Extract<LiveVault, { status: "ok" }> }) {
  const { vault, view } = live;
  const { accountId } = useWallet();
  const relation = relationOf(accountId, view);
  const cov = useVaultCoverage(vault);
  const meta = useTokenMeta(cov.state === "ok" ? cov.rows.map((r) => r.token) : []);
  const [open, setOpen] = useState(false);
  const label = (pk: string) => view.agents.find((a) => a.publicKey === pk)?.label ?? null;

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-[clamp(28px,4vw,44px)]">Coverage policies</h1>
          <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
            Pays out when a covered contract&apos;s code changes after your agents sent funds to it, whether the change was malicious or routine.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            What is not covered
          </Button>
          {relation !== "operator" && (
            <Link href={`/console/coverage/buy/?vault=${encodeURIComponent(vault)}`} tabIndex={-1}>
              <Button type="button">Buy coverage</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel title="Coverage held for this vault" aside={cov.state === "ok" ? <span className="mono text-sm text-muted">read at block {cov.head.toLocaleString("en-US")}</span> : undefined}>
          {cov.state === "loading" && <p className="text-sm text-muted">Reading the pool.</p>}
          {cov.state === "error" && <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">Could not read the pool. {cov.message}</p>}
          {cov.state === "ok" &&
            (cov.rows.length ? (
              <LiveCoverageTable rows={cov.rows} head={cov.head} agentLabel={label} meta={meta} />
            ) : (
              <p className="text-sm text-muted">No coverage yet for this vault. Your agents still run under their limits.</p>
            ))}
          <p className="mt-5 max-w-[80ch] text-sm text-muted">
            Payout is <span className="mono">min(recorded exposure x ratio, limit)</span>. Recorded exposure can differ from your real loss.
          </p>
        </Panel>
      </div>

      <Drawer open={open} onClose={() => setOpen(false)} title="Not covered">
        <NotCovered />
      </Drawer>
    </article>
  );
}
