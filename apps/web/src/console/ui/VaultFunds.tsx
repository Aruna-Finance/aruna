"use client";

import { useState } from "react";
import { Button } from "@/shared/Button";
import { availability, type ActorRole } from "../agent-actions";
import { nearToYocto, yoctoToNear } from "../fmt";
import { useBalance } from "../useBalance";
import { useLiveActions } from "../useLiveActions";
import type { LiveVault } from "../useLiveVault";
import { NumberField } from "./Field";
import { Panel } from "./Panel";
import { TokenIcon } from "./Token";

/** What the vault holds, and the two ways to move it: anyone with a wallet can deposit, only the owner can withdraw. */
export function VaultFunds({ live, actor, reason }: { live: Extract<LiveVault, { status: "ok" }>; actor: ActorRole | null; reason: string }) {
  const acts = useLiveActions(live.vault, live.refresh);
  const balance = useBalance(live.vault, live.view);
  const [dep, setDep] = useState(0);
  const [wd, setWd] = useState(0);
  const owner = live.view.owner;
  const wdOk = availability(actor ?? "operator", "withdraw");

  return (
    <Panel title="Funds" aside={<span className="text-[28px] leading-none">{balance === null ? "unknown" : yoctoToNear(balance.toString())} <small className="text-base text-muted">NEAR</small></span>}>
      <p className="-mt-2 mb-5 max-w-[70ch] text-sm leading-[1.6] text-muted">The money your agents spend sits here, not with the agents. Anyone with a wallet can deposit. Only the owner can take money out, and only to the owner&apos;s own account.</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid content-start gap-3">
          <NumberField label="Deposit" suffix={<TokenIcon t="NEAR" />} step={0.5} value={dep} onChange={setDep} />
          <div>
            <Button type="button" disabled={!acts.accountId || !(dep > 0)} onClick={() => acts.deposit(nearToYocto(dep))}>
              Deposit NEAR
            </Button>
            {!acts.accountId && <p className="mt-1 text-xs text-muted">Connect a wallet to deposit.</p>}
          </div>
        </div>
        {actor === "owner" ? (
          <div className="grid content-start gap-3">
            <NumberField label={`Withdraw to ${owner}`} suffix={<TokenIcon t="NEAR" />} step={0.5} value={wd} onChange={setWd} hint="Goes to the owner's account, whatever state the agents are in." />
            <div>
              <Button type="button" variant="outline" disabled={!wdOk.enabled || !(wd > 0)} onClick={() => acts.withdraw(nearToYocto(wd).toString(), owner)}>
                Withdraw to owner
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{actor === "operator" ? "Only the client can withdraw, and only to its own account." : `Withdrawing: ${reason}.`}</p>
        )}
      </div>
    </Panel>
  );
}
