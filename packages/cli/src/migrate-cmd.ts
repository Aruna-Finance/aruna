// `aruna migrate`: the one command here that signs (plan U15, KTD14). It moves a vault to the current
// vault version: the agents with their keys and policies, then the funds. Testnet only until the release
// gates pass (docs/PRODUCT.md). The key is read the way near-cli-rs's legacy keychain stores it
// (~/.near-credentials/<network>/<account>/ed25519_<key>.json), never from an argument or the environment.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import type { JournalStore, MigrationJournal, MigrationPlan, MigrationResult, MigrationTransport, StepInfo } from "@aruna/sdk/vault";

export const MIGRATE_USAGE = `  aruna migrate <old-vault> --name <new-name> --factory <factory> --as <owner-account> [--network testnet]
                [--journal <file>] [--dry-run] [--yes] [--accept-coverage-stays]
      Move a vault to the version <factory> makes now: pause its agents, create <new-name>.<factory> with the
      same owner, operator and ceiling, re-add every agent with its key and policy, move the NEAR and token
      balances, then revoke the agents on the old vault. Asks before each transaction unless --yes.
      Active coverage stays with the old vault; --accept-coverage-stays says you know (--yes alone does not).
      --dry-run reads and prints the plan and signs nothing. The journal file (default
      ./aruna-migrate-<old>-to-<name>.journal.json) lets a stopped run resume. Testnet only.
      Reads the owner's key from ~/.near-credentials/<network>/<owner-account>/, never from an argument.`;

export interface MigrateArgs {
  oldVault: string;
  name: string;
  factory: string;
  as: string;
  network: "testnet";
  journal: string | null;
  dryRun: boolean;
  yes: boolean;
  acceptCoverageStays: boolean;
}

export function parseMigrateArgs(argv: string[]): MigrateArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      factory: { type: "string" },
      as: { type: "string" },
      network: { type: "string" },
      journal: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      "accept-coverage-stays": { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 1) throw new Error("migrate takes exactly one old vault account id");
  for (const k of ["name", "factory", "as"] as const) if (!values[k]) throw new Error(`migrate needs --${k}`);
  const network = values.network ?? "testnet";
  if (network !== "testnet") throw new Error(`refusing --network ${network}: transactions are testnet-only until the release gates in docs/PRODUCT.md pass`);
  return {
    oldVault: positionals[0],
    name: values.name!,
    factory: values.factory!,
    as: values.as!,
    network,
    journal: values.journal ?? null,
    dryRun: values["dry-run"],
    yes: values.yes,
    acceptCoverageStays: values["accept-coverage-stays"],
  };
}

/** A journal in a JSON file. It holds hashes and amounts, never a key. */
export function fileJournal(path: string): JournalStore {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, "utf8")) as MigrationJournal;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error(`cannot read the journal ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    async save(j) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(j, null, 2) + "\n");
    },
  };
}

/**
 * The account's private key from near-cli-rs's legacy credentials directory: `<account>/ed25519_<public key>.json`
 * (what `save-to-legacy-keychain` writes), or the older single file `<account>.json`. With more than one key
 * file the first one holding a private key is used; the network refuses a call that key cannot sign.
 */
export async function readLegacyCredentials(account: string, network: string, dir = join(homedir(), ".near-credentials")): Promise<string> {
  const keyOf = (raw: string) => {
    const k = (JSON.parse(raw) as { private_key?: string }).private_key;
    return k?.startsWith("ed25519:") ? k : null;
  };
  const folder = join(dir, network, account);
  try {
    for (const f of (await readdir(folder)).filter((n) => n.endsWith(".json")).sort()) {
      const k = keyOf(await readFile(join(folder, f), "utf8"));
      if (k) return k;
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
  }
  const file = join(dir, network, `${account}.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Error(`no key for ${account} in ${folder}/ or at ${file}. Save it with near-cli-rs "save-to-legacy-keychain", then run again. The key is never taken from an argument.`);
  }
  const k = keyOf(raw);
  if (!k) throw new Error(`${file} has no ed25519 private_key`);
  return k;
}

const near = (yocto: string) => {
  const n = BigInt(yocto);
  const whole = n / 10n ** 24n;
  const frac = (n % 10n ** 24n).toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
  return `${whole}${frac ? "." + frac : ""} NEAR`;
};

export function describePlan(p: MigrationPlan): string {
  const L: string[] = [];
  L.push(`Move ${p.oldVault} (${p.oldVersion}) to ${p.newVault} (${p.targetVersion})`);
  L.push(`  owner ${p.owner}, operator ${p.operator ?? "none"}`);
  L.push(`  agents carried: ${p.agents.length}${p.revokedAgents ? ` (${p.revokedAgents} already revoked are left behind)` : ""}`);
  for (const a of p.agents) L.push(`    - ${a.label} ${a.publicKey}  ${a.statusBefore === "Paused" ? (a.autoDisabledBefore ? "auto-disabled, stays paused" : "paused, stays paused") : "active"}`);
  L.push(`  new vault: ${p.newVaultState === "ready" ? "already exists and matches" : `will be created with ${near(p.minDepositYocto)} from your account`}`);
  L.push(`  NEAR to move: ${near(p.funds.near.movableYocto)} (the old vault keeps ${near(p.funds.near.keepYocto)} for its storage)`);
  for (const t of p.funds.tokens) L.push(`  ${t.token} to move: ${t.balance} (smallest unit)`);
  if (p.coverage.status === "active") L.push(`  !! ACTIVE COVERAGE ${p.coverage.coverageIds.join(", ")} stays bound to ${p.oldVault} and is NOT moved.`);
  if (p.coverage.status === "unchecked") L.push(`  !! Coverage could not be checked (${p.coverage.reason}). It would stay with ${p.oldVault}.`);
  for (const n of p.notes) L.push(`  note: ${n}`);
  return L.join("\n");
}

export interface MigrateDeps {
  sdk: {
    planMigration: (o: {
      oldVault: string;
      factory: string;
      name: string;
      transport: MigrationTransport;
      network?: "testnet" | "mainnet";
      journal?: MigrationJournal | null;
    }) => Promise<MigrationPlan>;
    runMigration: (
      plan: MigrationPlan,
      o: { transport: MigrationTransport; journal: JournalStore; network?: "testnet" | "mainnet"; confirm?: (s: StepInfo) => Promise<boolean>; onEvent?: (e: { type: string; step: string; title?: string; tx?: string; why?: string }) => void; acceptCoverageStays?: boolean },
    ) => Promise<MigrationResult>;
  };
  makeTransport: (o: { signerId: string; privateKey: string; network: "testnet" }) => MigrationTransport;
  /** Asks a question on the terminal and returns the answer. */
  ask: (question: string) => Promise<string>;
  out: (line: string) => void;
  credentialsDir?: string;
  cwd?: string;
}

/** Exit codes: 0 done (or dry run), 1 refused or failed, 3 stopped by you, resumable. */
export async function runMigrateCommand(argv: string[], deps: MigrateDeps): Promise<number> {
  const a = parseMigrateArgs(argv); // mainnet is refused here, before any key is read
  const key = await readLegacyCredentials(a.as, a.network, deps.credentialsDir);
  const transport = deps.makeTransport({ signerId: a.as, privateKey: key, network: a.network });
  const journal = fileJournal(a.journal ?? join(deps.cwd ?? process.cwd(), `aruna-migrate-${a.oldVault}-to-${a.name}.journal.json`));

  const earlier = await journal.load();
  const plan = await deps.sdk.planMigration({ oldVault: a.oldVault, factory: a.factory, name: a.name, transport, network: a.network, journal: earlier });
  deps.out(describePlan(plan));
  if (earlier) deps.out(`  resuming from ${earlier.startedAt}`);
  if (a.dryRun) {
    deps.out(JSON.stringify(plan, null, 2));
    return 0;
  }

  let acceptCoverageStays = a.acceptCoverageStays;
  if (plan.coverage.status !== "none" && !acceptCoverageStays) {
    if (a.yes) {
      deps.out("Refusing: --yes does not accept that coverage stays behind. Add --accept-coverage-stays to say you know.");
      return 1;
    }
    acceptCoverageStays = (await deps.ask('Coverage stays with the old vault. Type "coverage stays" to continue: ')).trim().toLowerCase() === "coverage stays";
    if (!acceptCoverageStays) {
      deps.out("Stopped. Nothing was sent.");
      return 3;
    }
  }
  if (!a.yes && (await deps.ask("Start? Each transaction asks again. [y/N] ")).trim().toLowerCase() !== "y") {
    deps.out("Stopped. Nothing was sent.");
    return 3;
  }

  try {
    const result = await deps.sdk.runMigration(plan, {
      transport,
      journal,
      network: a.network,
      acceptCoverageStays,
      confirm: a.yes
        ? undefined
        : async (s) => {
            deps.out(`\n${s.title}\n${s.sends.map((x) => `  sign: ${x.receiver} ${x.method}, deposit ${x.depositYocto} yoctoNEAR`).join("\n")}`);
            return (await deps.ask("  sign this? [y/N] ")).trim().toLowerCase() === "y";
          },
      onEvent: (e) => deps.out(e.type === "sent" ? `  sent ${e.step}: ${e.tx}` : `  skipped ${e.step}: ${e.why}`),
    });
    deps.out(JSON.stringify(result, null, 2));
    deps.out(`Done. Point each agent at ${result.newVault}. The old vault keeps ${near(result.oldVaultRemaining.balanceYocto)}: ${result.oldVaultRemaining.reason}.`);
    return 0;
  } catch (e) {
    if (e instanceof Error && e.name === "MigrationAborted") {
      deps.out(`${e.message}. Run the same command again to resume from the journal.`);
      return 3;
    }
    throw e;
  }
}
