"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/shared/Button";
import { Drawer } from "@/shared/Drawer";
import { useActions } from "../useActions";
import { useCoverage } from "../useCoverage";
import { CoverageTable } from "../ui/CoverageTable";
import { HeartbeatAlert, NotCovered } from "../ui/CoverageNotes";
import { Panel } from "../ui/Panel";

export function Coverage() {
  const { isOperator } = useActions();
  const { policies, attestors } = useCoverage();
  const [open, setOpen] = useState(false);

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h1 className="text-[clamp(28px,4vw,44px)]">Coverage policies</h1>
          <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
            Pays when a covered contract&apos;s implementation changes while your agent has recorded exposure on it. The trigger pays,
            whether the upgrade was malicious or routine.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            What is not covered
          </Button>
          {!isOperator && (
            <Link href="/console/coverage/buy/" tabIndex={-1}>
              <Button type="button">Buy coverage</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <HeartbeatAlert attestors={attestors} />
        <Panel>
          {policies.length ? (
            <CoverageTable policies={policies} />
          ) : (
            <p className="text-sm text-muted">No coverage yet. Your agents still run under their limits.</p>
          )}
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
