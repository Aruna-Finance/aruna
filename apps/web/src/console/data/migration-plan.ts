import type { CoverageNotice, MigrationPlan, MigrationTransport } from "@aruna/sdk/vault";
import { yoctoToNear } from "../fmt";
import type { TestnetReads } from "../chain-reads";

// The console checks a migration; it does not send one. The plan is the SDK's own `planMigration`, which only reads and refuses before
// any step for every reason that can be known in advance. The migration is sent from the CLI, because it is several transactions
// in a fixed order that must be resumable, which a browser tab is not.

/** A transport that can read and nothing else. Every method that would sign throws, so a plan can never send anything. */
export function readOnlyMigrationTransport(reads: Pick<TestnetReads, "view" | "account">, signerId: string): MigrationTransport {
  const refuse = (): never => {
    throw new Error("The console checks a migration and does not send one. Use the command shown on the page.");
  };
  return {
    signerId,
    view: reads.view,
    account: reads.account,
    call: async () => refuse(),
    transfer: async () => refuse(),
    callBatch: async () => refuse(),
    txStatus: async () => refuse(),
  };
}

/** A first guess at the new vault's name: the old name with a number after it. The owner can change it. */
export function defaultNewName(oldVault: string): string {
  const label = oldVault.split(".")[0] ?? "vault";
  const m = /^(.*?)(\d+)$/.exec(label);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${label}2`;
}

export interface MigrateCommands {
  dryRun: string;
  run: string;
}

export function migrateCommands(plan: Pick<MigrationPlan, "oldVault" | "name" | "factory" | "coverage">, owner: string): MigrateCommands {
  const base = `node packages/cli/dist/index.js migrate ${plan.oldVault} --name ${plan.name} --factory ${plan.factory} --as ${owner}`;
  const stays = plan.coverage.status === "none" ? "" : " --accept-coverage-stays";
  return { dryRun: `${base} --dry-run`, run: `${base}${stays}` };
}

/** What the owner must read first (R39): coverage stays bound to the old vault and is not moved. */
export function coverageWarning(c: CoverageNotice): { level: "none" | "warn"; text: string } {
  if (c.status === "none") return { level: "none", text: "This vault has no coverage that is still on the book, so nothing is left behind." };
  if (c.status === "active")
    return {
      level: "warn",
      text: `Coverage ${c.coverageIds.map((i) => `#${i}`).join(", ")} stays bound to the old vault and is not moved. It keeps paying out against the old vault's recorded exposure until it ends. The new vault starts with none.`,
    };
  return { level: "warn", text: `The pool could not be read, so coverage could not be checked (${c.reason}). Treat it as active: it would stay bound to the old vault.` };
}

export interface PlanSummary {
  moves: string[];
  keeps: string;
}

/** The funds the migration would move and what the old vault keeps, in words. */
export function fundsSummary(plan: Pick<MigrationPlan, "funds">): PlanSummary {
  const f = plan.funds;
  const moves = [`${yoctoToNear(f.near.movableYocto)} NEAR`, ...f.tokens.filter((t) => BigInt(t.balance) > 0n).map((t) => `${t.balance} (smallest unit of ${t.token})`)];
  return { moves, keeps: `${yoctoToNear(f.near.keepYocto)} NEAR stays on the old vault for its storage and a margin` };
}
