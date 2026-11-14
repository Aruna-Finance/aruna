"use client";

import { ReadError } from "@/shared/ReadError";
import { planMigration, type MigrationPlan } from "@aruna/sdk/vault";
import { useMemo, useState } from "react";
import { Button } from "@/shared/Button";
import { createTestnetReads } from "../chain-reads";
import { FACTORY, vaultNameError } from "../data/factory";
import { coverageWarning, defaultNewName, fundsSummary, migrateCommands, readOnlyMigrationTransport } from "../data/migration-plan";
import { useLiveVault } from "../useLiveVault";
import { useWallet } from "../WalletContext";
import { CopyBlock } from "../ui/CopyBlock";
import { TextField } from "../ui/Field";
import { Panel } from "../ui/Panel";
import { PageHeader } from "../ui/PageHeader";

const th = "whitespace-nowrap border-b border-line-2 px-3 py-2 text-left font-medium";
const td = "border-b border-line px-3 py-3 align-top";

export type PlanState = { state: "idle" } | { state: "checking" } | { state: "refused"; message: string } | { state: "ok"; plan: MigrationPlan };

export function Migration() {
  const live = useLiveVault();
  const { accountId } = useWallet();
  const reads = useMemo(() => createTestnetReads(), []);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<PlanState>({ state: "idle" });
  if (live.status !== "ok") return <MigrationView vault={live.status === "none" ? null : live.vault} owner={null} account={accountId ?? null} name={name} setName={setName} plan={plan} check={() => {}} loading={live.status === "loading"} error={live.status === "error" ? live.message : null} />;

  const chosen = name || defaultNewName(live.vault);
  async function check() {
    if (live.status !== "ok" || !accountId) return;
    setPlan({ state: "checking" });
    try {
      const p = await planMigration({ oldVault: live.vault, factory: FACTORY, name: chosen, transport: readOnlyMigrationTransport(reads, accountId), network: "testnet" });
      setPlan({ state: "ok", plan: p });
    } catch (e) {
      setPlan({ state: "refused", message: e instanceof Error ? e.message : "The plan could not be made." });
    }
  }
  return <MigrationView vault={live.vault} owner={live.view.owner} account={accountId ?? null} name={chosen} setName={(v) => { setName(v); setPlan({ state: "idle" }); }} plan={plan} check={check} loading={false} error={null} />;
}

export function MigrationView({
  vault,
  owner,
  account,
  name,
  setName,
  plan,
  check,
  loading,
  error,
}: {
  vault: string | null;
  owner: string | null;
  account: string | null;
  name: string;
  setName: (v: string) => void;
  plan: PlanState;
  check: () => void;
  loading: boolean;
  error: string | null;
}) {
  const problem = name ? vaultNameError(name) : null;
  const canCheck = !!vault && !!account && !problem && name !== "" && plan.state !== "checking";
  return (
    <article>
      <PageHeader title="Migrate to a new vault">
        A vault&apos;s code can&apos;t change, so a new version means a new vault. This page checks the plan. The migration itself runs from the
        command line, so it can be resumed.
      </PageHeader>

      {!vault && !loading && !error && (
        <p className="mt-8 border border-line px-5 py-4 text-slate">Open a vault first: connect your wallet and choose one on the Overview.</p>
      )}
      {loading && <p className="mt-8 text-muted">Reading the vault.</p>}
      {error && <ReadError what="the vault" detail={error} className="mt-8" />}

      {vault && !loading && !error && (
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6">
          <Panel title="Check the plan">
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Old vault</dt>
                <dd className="mono break-all">{vault}</dd>
              </div>
              <div>
                <dt className="text-muted">Owner</dt>
                <dd className="mono break-all">{owner}</dd>
              </div>
            </dl>
            <div className="mt-5 max-w-xl">
              <TextField label={`New vault name (the account will be <name>.${FACTORY})`} mono value={name} onChange={setName} />
            </div>
            {problem && <p className="mt-2 text-sm text-dawn-ink">{problem}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button type="button" disabled={!canCheck} onClick={check}>
                {plan.state === "checking" ? "Checking" : "Check the plan"}
              </Button>
              {!account && <span className="text-sm text-muted">Connect the owner&apos;s wallet. Only the owner can migrate, and the check says so if you are not.</span>}
            </div>
          </Panel>

          {plan.state === "refused" && (
            <p className="border-l-[3px] border-dawn bg-dawn-wash px-5 py-4 text-[15px]">
              <strong className="font-medium">The plan was refused. Nothing was sent.</strong> {plan.message}
            </p>
          )}
          {plan.state === "ok" && <PlanBody plan={plan.plan} account={account!} />}
        </div>
      )}
    </article>
  );
}

function PlanBody({ plan, account }: { plan: MigrationPlan; account: string }) {
  const warn = coverageWarning(plan.coverage);
  const funds = fundsSummary(plan);
  const cmd = migrateCommands(plan, account);
  return (
    <>
      <p className={`border-l-[3px] px-5 py-4 leading-[1.6] ${warn.level === "warn" ? "border-dawn bg-dawn-wash" : "border-line-2"}`}>
        <strong className="font-medium">Coverage. </strong>
        {warn.text}
      </p>

      <Panel title="What it would do">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["From", `${plan.oldVault} (${plan.oldVersion})`],
              ["To", `${plan.newVault} (${plan.targetVersion})`],
              ["Owner kept", plan.owner],
              ["Operator kept", plan.operator ?? "none"],
              ["New vault", plan.newVaultState === "ready" ? "already exists and is a copy of this one" : "will be created by the factory"],
              ["Minimum deposit", `${plan.minDepositYocto} yoctoNEAR`],
            ] as const
          ).map(([l, v]) => (
            <div key={l}>
              <dt className="text-muted">{l}</dt>
              <dd className="mono break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <ol className="mt-6 grid gap-0 text-sm">
          {[
            "Pause every agent being carried over, so no key can spend on both vaults.",
            "Create the new vault with the same owner, operator and ceiling.",
            "Re-add each carried agent with its key, label and policy.",
            "Move the funds.",
            "Revoke the carried agents on the old vault.",
          ].map((t, i) => (
            <li key={t} className="grid grid-cols-[2rem_1fr] gap-x-3 border-t border-line py-2 first:border-t-0">
              <span className="mono text-muted">{i + 1}</span>
              <span className="text-slate">{t}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title={`Agents carried over (${plan.agents.length})`}>
        {plan.agents.length === 0 ? (
          <p className="text-sm text-muted">No agent would be carried over.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[15px]">
              <thead>
                <tr>
                  <th className={th}>Label</th>
                  <th className={th}>Public key</th>
                  <th className={th}>Status before</th>
                </tr>
              </thead>
              <tbody>
                {plan.agents.map((a) => (
                  <tr key={a.publicKey}>
                    <td className={td}>{a.label}</td>
                    <td className={`${td} mono break-all text-sm`}>{a.publicKey}</td>
                    <td className={td}>
                      {a.statusBefore}
                      {a.autoDisabledBefore && <span className="block text-xs text-muted">auto-disabled</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-sm text-muted">
          {plan.revokedAgents} already revoked, not carried. {plan.agentsWithReservations} with spends in flight.
        </p>
      </Panel>

      <Panel title="Funds">
        <p className="text-[15px]">
          Would move: <span className="mono">{funds.moves.join(", ")}</span>.
        </p>
        <p className="mt-2 text-sm text-muted">{funds.keeps}. Whatever is left on the old vault stays there and can always be withdrawn to the owner.</p>
        {plan.notes.length > 0 && (
          <ul className="mt-4 grid gap-2 text-sm text-slate">
            {plan.notes.map((n) => (
              <li key={n} className="flex gap-3">
                <i aria-hidden className="mt-1.5 block size-2 shrink-0 bg-ink" />
                {n}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Run it">
        <p className="max-w-[80ch] text-sm leading-[1.6] text-slate">
          The migration is sent from the command line, on testnet, with the owner&apos;s key from the keychain. First the same plan, which signs nothing:
        </p>
        <div className="mt-3">
          <CopyBlock text={cmd.dryRun} />
        </div>
        <p className="mt-4 text-sm text-slate">Then the migration. It asks before each transaction, and a stopped run resumes from its journal:</p>
        <div className="mt-3">
          <CopyBlock text={cmd.run} />
        </div>
      </Panel>
    </>
  );
}
