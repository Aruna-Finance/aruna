"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/shared/Button";
import { isSafeAccountId } from "@/landing/lib/verify-commands";
import { yoctoToNear } from "../fmt";
import { useOwnedVaults } from "../useOwnedVaults";
import { useVaultView } from "../useVaultView";
import { TextField } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { agentPageHref } from "../ui/agentPageHref";
import { useWallet } from "../WalletContext";
import { RELATION_TEXT, relationOf } from "../walletRole";

// The vault the team's agent examples use (docs/AUDIT-v0.md). A real testnet vault, read live.
export const EXAMPLE_VAULT = "demo2.factory.arunafi.testnet";

const th = "border-b border-line-2 px-3 py-2 text-left font-medium whitespace-nowrap";
const td = "border-b border-line px-3 py-3 align-top";

export function Lookup() {
  const first = useSearchParams().get("vault") ?? EXAMPLE_VAULT;
  const [draft, setDraft] = useState(first);
  const [vault, setVault] = useState(first);
  const state = useVaultView(isSafeAccountId(vault) ? vault : "");
  const bad = draft !== "" && !isSafeAccountId(draft.trim());
  const { accountId } = useWallet();
  const owned = useOwnedVaults(accountId ?? null);
  const relation = state.status === "ok" ? relationOf(accountId, state.view) : null;

  function pick(v: string) {
    setDraft(v);
    setVault(v);
  }

  return (
    <article>
      <h1 className="text-[clamp(28px,4vw,44px)]">Look up an agent before you transact with it</h1>
      <p className="mt-4 max-w-[70ch] leading-[1.6] text-slate">
        See what an agent&apos;s vault allows before you deal with it. No login needed.
      </p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
        <Panel>
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!bad) setVault(draft.trim());
            }}
          >
            <div className="w-full flex-1 sm:min-w-72 sm:max-w-xl">
              <TextField
                label="Vault account"
                value={draft}
                onChange={setDraft}
                mono
                hint={bad ? "Use lowercase letters, digits, dots, dashes and underscores." : undefined}
              />
            </div>
            <Button type="submit" disabled={bad || !draft}>
              Look up
            </Button>
          </form>
          <p className="mt-3 text-sm text-muted">
            Try{" "}
            <button type="button" className="mono underline underline-offset-4" onClick={() => pick(EXAMPLE_VAULT)}>
              {EXAMPLE_VAULT}
            </button>
            , a live testnet vault.
          </p>
          {owned.state === "ok" && owned.list.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              Yours:
              {owned.list.map((v) => (
                <button key={v.vault} type="button" className="mono underline underline-offset-4" onClick={() => pick(v.vault)}>
                  {v.vault}
                </button>
              ))}
            </p>
          )}
        </Panel>

        {state.status === "loading" && (
          <p className="text-muted" role="status">
            Reading {vault} from the network.
          </p>
        )}

        {state.status === "error" && (
          <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px] leading-[1.6]">
            Could not read <span className="mono">{vault}</span> as an Aruna vault. {state.message}. Check the account id, or that it is
            a vault on testnet.
          </p>
        )}

        {state.status === "ok" && (
          <>
            <Panel title="Who controls the money">
              {relation && (
                <p
                  className={`mb-5 border-l-[3px] px-5 py-3 text-[15px] leading-[1.6] ${relation === "none" ? "border-line-2 bg-wash" : "border-ink bg-fog"}`}
                  role="status"
                >
                  {RELATION_TEXT[relation]} <span className="mono text-sm">{accountId}</span>
                </p>
              )}
              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted">Vault</dt>
                  <dd className="mono break-all">{state.view.vault}</dd>
                </div>
                <div>
                  <dt className="text-muted">Owner</dt>
                  <dd className="mono break-all">{state.view.owner}</dd>
                </div>
                <div>
                  <dt className="text-muted">Operator</dt>
                  <dd className="mono break-all">{state.view.operator ?? "None"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Full-access keys on the vault</dt>
                  <dd className="mono">{state.view.fullAccessKeys}</dd>
                </div>
                <div>
                  <dt className="text-muted">Keys the vault does not know</dt>
                  <dd className="mono">{state.view.unknownKeys.length}</dd>
                </div>
                {state.view.ceiling && (
                  <div>
                    <dt className="text-muted">Owner ceiling</dt>
                    <dd className="mono">
                      {yoctoToNear(state.view.ceiling.maxPerTx)} NEAR per tx, {yoctoToNear(state.view.ceiling.dailyTotal)} NEAR per day
                    </dd>
                  </div>
                )}
              </dl>
            </Panel>

            <Panel title={`Agents on this vault (${state.view.agents.length})`}>
              {state.view.agents.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-[15px]">
                    <thead>
                      <tr>
                        <th className={th}>Agent</th>
                        <th className={th}>Status</th>
                        <th className={th}>Public key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.view.agents.map((a) => (
                        <tr key={a.publicKey}>
                          <td className={td}>
                            <Link href={agentPageHref(state.view.vault, a.publicKey)} className="font-medium underline underline-offset-4">
                              {a.label}
                            </Link>
                          </td>
                          <td className={`${td} ${a.status !== "Active" || a.autoDisabled ? "text-dawn-ink" : ""}`}>
                            {a.autoDisabled ? "Auto-disabled" : a.status}
                          </td>
                          <td className={`${td} mono text-sm break-all`}>{a.publicKey}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted">This vault has no agents.</p>
              )}
            </Panel>
          </>
        )}
      </div>
    </article>
  );
}
