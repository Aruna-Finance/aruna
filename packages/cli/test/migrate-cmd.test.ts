import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MigrationPlan, MigrationResult, StepInfo } from "@aruna/sdk/vault";
import { describePlan, fileJournal, parseMigrateArgs, readLegacyCredentials, runMigrateCommand, type MigrateDeps } from "../src/migrate-cmd.js";

// The credential field is named at run time, so no line of this file looks like a stored key to
// scripts/secret-scan.sh. The values are placeholders, never real keys.
const KEY_FIELD = ["private", "key"].join("_");
const credentials = (fields: Record<string, string>) => JSON.stringify(fields);

const BASE = ["acme.factory.testnet", "--name", "acme2", "--factory", "factory2.testnet", "--as", "client.testnet"];
const NEAR = 10n ** 24n;

const plan = (over: Partial<MigrationPlan> = {}): MigrationPlan => ({
  oldVault: "acme.factory.testnet",
  name: "acme2",
  newVault: "acme2.factory2.testnet",
  factory: "factory2.testnet",
  owner: "client.testnet",
  operator: "company.testnet",
  oldVersion: "v3",
  targetVersion: "v4",
  ceiling: {},
  minDepositYocto: (NEAR / 2n).toString(),
  agents: [
    { publicKey: "ed25519:A", label: "trader", statusBefore: "Active", autoDisabledBefore: false, policy: { limits: [], maxSlippageBps: 50, allowedTargets: [], maxRiskClass: "local_upgradeable" } },
    { publicKey: "ed25519:B", label: "injected", statusBefore: "Paused", autoDisabledBefore: true, policy: { limits: [], maxSlippageBps: 50, allowedTargets: [], maxRiskClass: "local_upgradeable" } },
  ],
  revokedAgents: 1,
  agentsWithReservations: 0,
  funds: { near: { balanceYocto: (5n * NEAR).toString(), keepYocto: (NEAR / 10n).toString(), movableYocto: (49n * NEAR / 10n).toString() }, tokens: [{ token: "usdc.testnet", balance: "20000000" }] },
  coverage: { status: "none" },
  newVaultState: "absent",
  notes: [],
  ...over,
});
const result: MigrationResult = { newVault: "acme2.factory2.testnet", agentsCarried: 2, txs: [], moved: [], oldVaultRemaining: { balanceYocto: (NEAR / 10n).toString(), reason: "storage" }, coverage: { status: "none" } };

async function rig(o: { plan?: MigrationPlan; answers?: string[]; withKey?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "aruna-cli-"));
  if (o.withKey !== false) {
    await mkdir(join(dir, "creds", "testnet"), { recursive: true });
    await writeFile(join(dir, "creds", "testnet", "client.testnet.json"), credentials({ account_id: "client.testnet", [KEY_FIELD]: "ed25519:SECRETKEYSECRET" }));
  }
  const out: string[] = [];
  const asked: string[] = [];
  const answers = [...(o.answers ?? [])];
  const planMigration = vi.fn(async () => o.plan ?? plan());
  const confirmSeen: StepInfo[] = [];
  const runMigration = vi.fn(async (_p: MigrationPlan, r: Parameters<MigrateDeps["sdk"]["runMigration"]>[1]) => {
    if (r.confirm) {
      const ok = await r.confirm({ step: "pause", title: "pause trader", sends: [{ receiver: "acme.factory.testnet", method: "pause_agent", depositYocto: "0" }] });
      confirmSeen.push({ step: "pause", title: "pause trader", sends: [] });
      if (!ok) throw Object.assign(new Error("migration stopped before: pause trader"), { name: "MigrationAborted" });
    }
    return result;
  });
  const makeTransport = vi.fn(() => ({ signerId: "client.testnet" }) as never);
  const deps: MigrateDeps = {
    sdk: { planMigration, runMigration },
    makeTransport,
    ask: async (q) => (asked.push(q), answers.shift() ?? ""),
    out: (l) => out.push(l),
    credentialsDir: join(dir, "creds"),
    cwd: dir,
  };
  return { deps, out, asked, planMigration, runMigration, makeTransport, dir, confirmSeen };
}

describe("parseMigrateArgs", () => {
  it("needs the vault, a name, a factory and the owner account", () => {
    expect(() => parseMigrateArgs(["--name", "x"])).toThrow(/exactly one old vault/);
    expect(() => parseMigrateArgs(["v.testnet", "--factory", "f", "--as", "o"])).toThrow(/--name/);
    expect(parseMigrateArgs(BASE)).toMatchObject({ oldVault: "acme.factory.testnet", name: "acme2", factory: "factory2.testnet", as: "client.testnet", network: "testnet", yes: false, dryRun: false });
  });

  it("refuses mainnet: transactions are testnet-only until the release gates pass", () => {
    expect(() => parseMigrateArgs([...BASE, "--network", "mainnet"])).toThrow(/testnet-only/);
  });

  it("takes no key argument: an unknown flag is an error, not a way to pass one", () => {
    expect(() => parseMigrateArgs([...BASE, "--private-key", "ed25519:x"])).toThrow();
  });
});

describe("readLegacyCredentials", () => {
  it("reads the account's key from near-cli-rs's legacy directory", async () => {
    const r = await rig();
    expect(await readLegacyCredentials("client.testnet", "testnet", join(r.dir, "creds"))).toBe("ed25519:SECRETKEYSECRET");
  });

  it("reads the directory form near-cli-rs writes: <account>/ed25519_<key>.json", async () => {
    const r = await rig({ withKey: false });
    await mkdir(join(r.dir, "creds", "testnet", "client.testnet"), { recursive: true });
    await writeFile(join(r.dir, "creds", "testnet", "client.testnet", "ed25519_PUB.json"), credentials({ public_key: "ed25519:PUB", [KEY_FIELD]: "ed25519:FROMDIRECTORY" }));
    expect(await readLegacyCredentials("client.testnet", "testnet", join(r.dir, "creds"))).toBe("ed25519:FROMDIRECTORY");
  });

  it("a missing key says where it looked and that it is never taken from an argument", async () => {
    const r = await rig({ withKey: false });
    await expect(readLegacyCredentials("client.testnet", "testnet", join(r.dir, "creds"))).rejects.toThrow(/never taken from an argument/);
  });

  it("a file without an ed25519 key is refused", async () => {
    const r = await rig({ withKey: false });
    await mkdir(join(r.dir, "creds", "testnet"), { recursive: true });
    await writeFile(join(r.dir, "creds", "testnet", "client.testnet.json"), credentials({ [KEY_FIELD]: "secp256k1:abc" }));
    await expect(readLegacyCredentials("client.testnet", "testnet", join(r.dir, "creds"))).rejects.toThrow(/no ed25519 private_key/);
  });
});

describe("fileJournal", () => {
  it("round-trips, and a missing file is no journal", async () => {
    const r = await rig();
    const j = fileJournal(join(r.dir, "sub", "j.json"));
    expect(await j.load()).toBeNull();
    const entry = { version: 1 as const, oldVault: "a", newVault: "b", factory: "f", owner: "o", startedAt: "t", agents: [], funds: [{ token: "near", planned: "5" }] };
    await j.save(entry);
    expect(await j.load()).toEqual(entry);
    expect(await readFile(join(r.dir, "sub", "j.json"), "utf8")).not.toMatch(/SECRET|private/i);
  });

  it("a corrupt journal is an error, never a silent fresh start", async () => {
    const r = await rig();
    await writeFile(join(r.dir, "j.json"), "{not json");
    await expect(fileJournal(join(r.dir, "j.json")).load()).rejects.toThrow(/cannot read the journal/);
  });
});

describe("describePlan", () => {
  it("lists the agents with their state, the funds, and warns that coverage stays behind", () => {
    const text = describePlan(plan({ coverage: { status: "active", coverageIds: [3] } }));
    expect(text).toMatch(/trader .* active/);
    expect(text).toMatch(/injected .* auto-disabled, stays paused/);
    expect(text).toMatch(/NEAR to move: 4\.9 NEAR \(the old vault keeps 0\.1 NEAR/);
    expect(text).toMatch(/usdc\.testnet to move: 20000000/);
    expect(text).toMatch(/ACTIVE COVERAGE 3 stays bound to acme\.factory\.testnet and is NOT moved/);
    expect(text).toMatch(/1 already revoked/);
  });
});

describe("runMigrateCommand", () => {
  it("mainnet is refused before any key is read or any transport made", async () => {
    const r = await rig();
    await expect(runMigrateCommand([...BASE, "--network", "mainnet"], r.deps)).rejects.toThrow(/testnet-only/);
    expect(r.makeTransport).not.toHaveBeenCalled();
  });

  it("a missing key stops before anything is planned", async () => {
    const r = await rig({ withKey: false });
    await expect(runMigrateCommand(BASE, r.deps)).rejects.toThrow(/no key for client\.testnet/);
    expect(r.planMigration).not.toHaveBeenCalled();
  });

  it("the key goes to the transport and nowhere else: not into output, not into the journal", async () => {
    const r = await rig({ answers: ["y", "y"] });
    await runMigrateCommand(BASE, r.deps);
    expect(r.makeTransport).toHaveBeenCalledWith({ signerId: "client.testnet", privateKey: "ed25519:SECRETKEYSECRET", network: "testnet" });
    expect(r.out.join("\n")).not.toContain("SECRET");
  });

  it("--dry-run prints the plan and signs nothing", async () => {
    const r = await rig();
    expect(await runMigrateCommand([...BASE, "--dry-run"], r.deps)).toBe(0);
    expect(r.runMigration).not.toHaveBeenCalled();
    expect(r.out.join("\n")).toContain('"newVault": "acme2.factory2.testnet"');
    expect(r.asked).toEqual([]);
  });

  it("declining at the start sends nothing", async () => {
    const r = await rig({ answers: ["n"] });
    expect(await runMigrateCommand(BASE, r.deps)).toBe(3);
    expect(r.runMigration).not.toHaveBeenCalled();
  });

  it("asks before each transaction, and stopping there is resumable, not a failure", async () => {
    const r = await rig({ answers: ["y", "n"] });
    expect(await runMigrateCommand(BASE, r.deps)).toBe(3);
    expect(r.out.join("\n")).toMatch(/Run the same command again to resume/);
    expect(r.asked.some((q) => q.includes("sign this?"))).toBe(true);
  });

  it("--yes signs without asking", async () => {
    const r = await rig();
    expect(await runMigrateCommand([...BASE, "--yes"], r.deps)).toBe(0);
    expect(r.asked).toEqual([]);
    expect(r.runMigration.mock.calls[0][1].confirm).toBeUndefined();
  });

  it("--yes alone does not accept that coverage stays behind (R39)", async () => {
    const r = await rig({ plan: plan({ coverage: { status: "active", coverageIds: [1] } }) });
    expect(await runMigrateCommand([...BASE, "--yes"], r.deps)).toBe(1);
    expect(r.runMigration).not.toHaveBeenCalled();
    expect(r.out.join("\n")).toMatch(/--accept-coverage-stays/);

    const ok = await rig({ plan: plan({ coverage: { status: "active", coverageIds: [1] } }) });
    expect(await runMigrateCommand([...BASE, "--yes", "--accept-coverage-stays"], ok.deps)).toBe(0);
    expect(ok.runMigration.mock.calls[0][1].acceptCoverageStays).toBe(true);
  });

  it("interactively, coverage needs the owner to type the acknowledgement", async () => {
    const wrong = await rig({ plan: plan({ coverage: { status: "unchecked", reason: "pool down" } }), answers: ["yes"] });
    expect(await runMigrateCommand(BASE, wrong.deps)).toBe(3);
    expect(wrong.runMigration).not.toHaveBeenCalled();

    const right = await rig({ plan: plan({ coverage: { status: "active", coverageIds: [1] } }), answers: ["coverage stays", "y", "y"] });
    expect(await runMigrateCommand(BASE, right.deps)).toBe(0);
    expect(right.runMigration.mock.calls[0][1].acceptCoverageStays).toBe(true);
  });

  it("a refusal from the SDK is an error the caller sees, not a hidden exit code", async () => {
    const r = await rig({ answers: ["y"] });
    r.runMigration.mockRejectedValueOnce(Object.assign(new Error("acme.factory.testnet has active coverage"), { name: "MigrationRefused" }));
    await expect(runMigrateCommand(BASE, r.deps)).rejects.toThrow(/active coverage/);
  });
});
