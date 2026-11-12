import { describe, expect, it } from "vitest";
import {
  ArunaAuthError,
  CURRENT_VAULT_HASH,
  KNOWN_VAULT_VERSIONS,
  MigrationAborted,
  MigrationNeedsReview,
  MigrationRefused,
  memoryJournal,
  planMigration,
  runMigration,
  VaultVersionError,
  type MigrationJournal,
  type MigrationTransport,
  type RunOptions,
} from "../src/vault/index.js";
import type { VaultView } from "../src/vault-view.js";

const hashOf = (v: string) => Object.entries(KNOWN_VAULT_VERSIONS).find(([, n]) => n === v)![0];
const OWNER = "client.testnet";
const OPERATOR = "company.testnet";
const FACTORY = "factory2.testnet";
const OLD = "acme.factory.testnet";
const NEW = `acme2.${FACTORY}`;
const USDC = "usdc.testnet";
const POOL = "pool2.testnet";
const KEEP = 1000n * 10n ** 19n + 10n ** 21n; // 1000 bytes of storage plus the margin
const NEAR = 10n ** 24n;

type Status = "Active" | "Paused" | "Revoked";
interface Agent {
  label: string;
  status: Status;
  auto_disabled: boolean;
  policy: { limits: { token: unknown; max_per_tx: string; daily_cap: string }[]; max_slippage_bps: number; allowed_targets: string[]; max_risk_class: string };
}
interface Vault {
  hash: string;
  owner: string;
  operator: string | null;
  ceiling: { tokens: { token: unknown; max_per_tx: string; daily_total: string }[]; max_risk_class: string; allowed_targets: string[]; agent_allowance: string };
  agents: Map<string, Agent>;
}

const policy = (cap: bigint): Agent["policy"] => ({
  limits: [
    { token: "near", max_per_tx: (NEAR / 2n).toString(), daily_cap: cap.toString() },
    { token: { ft: USDC }, max_per_tx: "5000000", daily_cap: "10000000" },
  ],
  max_slippage_bps: 50,
  allowed_targets: ["swap.testnet"],
  max_risk_class: "local_upgradeable",
});
const ceilingRaw = () => ({
  tokens: [
    { token: "near", max_per_tx: NEAR.toString(), daily_total: (4n * NEAR).toString() },
    { token: { ft: USDC }, max_per_tx: "10000000", daily_total: "40000000" },
  ],
  max_risk_class: "local_upgradeable",
  allowed_targets: ["swap.testnet"],
  agent_allowance: (2n * NEAR).toString(),
});

/** A small chain: vaults, a factory, a token, a pool. Every call is recorded; `crashAfter` kills the process after a call took effect. */
class Chain {
  balances = new Map<string, bigint>([[OWNER, 100n * NEAR], [OLD, 5n * NEAR], [FACTORY, 10n * NEAR]]);
  accounts = new Map<string, { hash: string | null; storage: number }>([[OLD, { hash: hashOf("v3"), storage: 1000 }], [OWNER, { hash: null, storage: 0 }], [FACTORY, { hash: null, storage: 0 }]]);
  vaults = new Map<string, Vault>();
  ft = new Map<string, bigint>([[OLD, 20_000_000n]]);
  registered = new Set<string>([OLD]);
  coverages: { id: number; vault: string; released: boolean }[] = [];
  poolFails = false;
  /** A registry from before coverage: it has no `pool` view. */
  noPoolMethod = false;
  factoryHash = CURRENT_VAULT_HASH;
  txStatus = new Map<string, "success" | "failed" | "unknown">();
  log: { contract: string; method: string; args: Record<string, unknown>; deposit: bigint }[] = [];
  private n = 0;
  crashAfter: number | null = null;
  signer = OWNER;

  constructor(agents: [string, string, Status, boolean, bigint][] = [["pk1", "trader-1", "Active", false, NEAR], ["pk2", "trader-2", "Active", false, NEAR / 2n], ["pk3", "paused-one", "Paused", false, NEAR / 4n], ["pk4", "retired", "Revoked", false, NEAR / 4n]]) {
    this.vaults.set(OLD, { hash: hashOf("v3"), owner: OWNER, operator: OPERATOR, ceiling: ceilingRaw(), agents: new Map(agents.map(([k, label, status, auto, cap]) => [k, { label, status, auto_disabled: auto, policy: policy(cap) }])) });
  }

  /** The old vault's public state, as `readVault` would return it. */
  viewOf = async (id: string): Promise<VaultView> => {
    const v = this.vaults.get(id)!;
    return {
      vault: id,
      owner: v.owner,
      operator: v.operator,
      shape: "per-token",
      ceiling: {
        maxPerTx: NEAR.toString(),
        dailyTotal: (4n * NEAR).toString(),
        maxRiskClass: v.ceiling.max_risk_class,
        allowedTargets: v.ceiling.allowed_targets,
        agentAllowance: v.ceiling.agent_allowance,
        tokens: v.ceiling.tokens.map((t) => ({ token: t.token === "near" ? "near" : (t.token as { ft: string }).ft, maxPerTx: t.max_per_tx, dailyTotal: t.daily_total })),
      },
      exposure: null,
      fullAccessKeys: 0,
      agents: [...v.agents].map(([publicKey, a]) => ({
        publicKey,
        label: a.label,
        status: a.status,
        autoDisabled: a.auto_disabled,
        policy: {
          maxPerTx: a.policy.limits[0].max_per_tx,
          dailyCap: a.policy.limits[0].daily_cap,
          maxSlippageBps: a.policy.max_slippage_bps,
          allowedTargets: a.policy.allowed_targets,
          maxRiskClass: a.policy.max_risk_class,
          limits: a.policy.limits.map((l) => ({ token: l.token === "near" ? "near" : (l.token as { ft: string }).ft, maxPerTx: l.max_per_tx, dailyCap: l.daily_cap })),
        },
        usage: null,
        key: null,
        cannot: [],
      })),
      unknownKeys: [],
      operatorCannot: [],
    };
  };

  private effect(contract: string, method: string, args: Record<string, unknown>, deposit: bigint, signer: string) {
    const bal = (id: string) => this.balances.get(id) ?? 0n;
    const vault = this.vaults.get(contract);
    if (vault) {
      const isV1 = this.accounts.get(contract)!.hash === hashOf("v1");
      const ownerOnly = ["add_agent", "withdraw_to_owner"].includes(method);
      if (isV1 && deposit !== 0n) throw new ArunaAuthError("Method doesn't accept deposit");
      if (!isV1 && ownerOnly && deposit !== 1n) throw new ArunaAuthError("Requires attached deposit of exactly 1 yoctoNEAR");
      if (signer !== vault.owner && signer !== vault.operator) throw new ArunaAuthError("ARUNA_NOT_OWNER_OR_OPERATOR");
      const pk = args.public_key as string;
      if (method === "pause_agent") vault.agents.get(pk)!.status = "Paused";
      else if (method === "revoke_agent") vault.agents.get(pk)!.status = "Revoked";
      else if (method === "add_agent") {
        if (vault.agents.has(pk)) throw new ArunaAuthError("ARUNA_AGENT_EXISTS");
        vault.agents.set(pk, { label: args.label as string, status: "Active", auto_disabled: false, policy: args.policy as Agent["policy"] });
      } else if (method === "withdraw_to_owner") {
        const amount = BigInt(args.amount as string);
        const token = args.token as { ft: string } | undefined;
        if (!token) {
          if (bal(contract) - amount < KEEP) throw new ArunaAuthError("LackBalanceForState");
          this.balances.set(contract, bal(contract) - amount);
          this.balances.set(vault.owner, bal(vault.owner) + amount);
        } else {
          if (!this.registered.has(vault.owner)) throw new ArunaAuthError("owner is not registered at the token");
          this.ft.set(contract, (this.ft.get(contract) ?? 0n) - amount);
          this.ft.set(vault.owner, (this.ft.get(vault.owner) ?? 0n) + amount);
        }
      } else throw new Error(`fake vault has no ${method}`);
      return;
    }
    if (contract === FACTORY && method === "create_vault") {
      const id = `${args.name}.${FACTORY}`;
      this.balances.set(id, deposit);
      this.accounts.set(id, { hash: this.factoryHash, storage: 800 });
      this.vaults.set(id, { hash: this.factoryHash, owner: args.owner as string, operator: args.operator as string | null, ceiling: args.ceiling as Vault["ceiling"], agents: new Map() });
      this.balances.set(signer, bal(signer) - deposit);
      return;
    }
    if (contract === USDC && method === "storage_deposit") {
      this.registered.add(args.account_id as string);
      return;
    }
    if (contract === USDC && method === "ft_transfer_call") {
      const to = args.receiver_id as string;
      if (!this.registered.has(to)) throw new ArunaAuthError("receiver is not registered at the token");
      const amount = BigInt(args.amount as string);
      this.ft.set(signer, (this.ft.get(signer) ?? 0n) - amount);
      this.ft.set(to, (this.ft.get(to) ?? 0n) + amount);
      return;
    }
    throw new Error(`fake chain has no ${contract}.${method}`);
  }

  private tick(tx: string) {
    this.txStatus.set(tx, "success");
    if (this.crashAfter !== null && this.log.length >= this.crashAfter) throw new Error(`process died after ${tx}`);
  }

  transport(): MigrationTransport {
    const self = this;
    return {
      signerId: this.signer,
      async view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
        const vault = self.vaults.get(contract);
        if (method === "get_config" && vault) return { owner: vault.owner, operator: vault.operator, registry: "registry2.testnet", ceiling: vault.ceiling, agent_methods: ["spend", "refresh_class"] } as T;
        if (method === "get_agents" && vault) return [...vault.agents].map(([k, a]) => [k, a]) as T;
        if (method === "get_config" && contract === FACTORY) return { owner: "root", registry: "registry2.testnet", vault_code_hash: self.factoryHash, min_deposit: (NEAR / 2n).toString() } as T;
        if (method === "pool") {
          if (self.noPoolMethod) throw new Error("Contract method is not found at block height 123");
          return POOL as T;
        }
        if (contract === POOL) {
          if (self.poolFails) throw new Error("pool unreachable");
          if (method === "coverage_count") return self.coverages.length as T;
          if (method === "get_coverage") return (self.coverages[args.id as number] ?? null) as T;
        }
        if (contract === USDC && method === "ft_balance_of") return (self.ft.get(args.account_id as string) ?? 0n).toString() as T;
        if (contract === USDC && method === "storage_balance_of") return (self.registered.has(args.account_id as string) ? { total: "1", available: "0" } : null) as T;
        if (contract === USDC && method === "storage_balance_bounds") return { min: "12500000000000000000000" } as T;
        throw new Error(`fake chain has no view ${contract}.${method}`);
      },
      async call(contract, method, args, opts) {
        self.log.push({ contract, method, args, deposit: opts.depositYocto });
        self.effect(contract, method, args, opts.depositYocto, self.signer);
        const tx = `tx${++self.n}`;
        self.tick(tx);
        return { value: null, tx };
      },
      async callBatch(contract, calls) {
        // All or none: effects are applied to a copy first.
        const before = structuredClone([...(self.vaults.get(contract)?.agents ?? [])]);
        try {
          for (const c of calls) {
            self.log.push({ contract, method: c.method, args: c.args, deposit: c.depositYocto });
            self.effect(contract, c.method, c.args, c.depositYocto, self.signer);
          }
        } catch (e) {
          if (self.vaults.get(contract)) self.vaults.get(contract)!.agents = new Map(before);
          throw e;
        }
        const tx = `tx${++self.n}`;
        self.tick(tx);
        return { value: null, tx };
      },
      async transfer(receiver, amount) {
        self.log.push({ contract: receiver, method: "transfer", args: { amount: amount.toString() }, deposit: amount });
        self.balances.set(self.signer, (self.balances.get(self.signer) ?? 0n) - amount);
        self.balances.set(receiver, (self.balances.get(receiver) ?? 0n) + amount);
        const tx = `tx${++self.n}`;
        self.tick(tx);
        return { tx };
      },
      async txStatus(tx) {
        return self.txStatus.get(tx) ?? "unknown";
      },
      async account(id) {
        const a = self.accounts.get(id);
        if (!a) throw new Error(`UNKNOWN_ACCOUNT: ${id}`);
        return { amount: (self.balances.get(id) ?? 0n).toString(), globalContractHash: a.hash, storageUsage: a.storage };
      },
    };
  }

  methods() {
    return this.log.map((c) => c.method);
  }
}

const plan = (c: Chain, over: Partial<Parameters<typeof planMigration>[0]> = {}) => planMigration({ oldVault: OLD, factory: FACTORY, name: "acme2", transport: c.transport(), readOld: c.viewOf, ...over });
const run = async (c: Chain, journal = memoryJournal(), o: Partial<RunOptions> = {}, p?: Awaited<ReturnType<typeof planMigration>>) => runMigration(p ?? (await plan(c, { journal: journal.current() })), { transport: c.transport(), journal, ...o });

describe("planMigration refuses before any step", () => {
  it("a vault at a code hash the SDK does not know is refused, naming the hash, with nothing sent (AE9)", async () => {
    const c = new Chain();
    c.accounts.get(OLD)!.hash = "UnknownHash111";
    await expect(plan(c)).rejects.toThrow(VaultVersionError);
    await expect(plan(c)).rejects.toThrow(/UnknownHash111/);
    expect(c.log).toEqual([]);
  });

  it("an account that is not the owner is refused at plan time, so an operator cannot half-migrate", async () => {
    const c = new Chain();
    c.signer = OPERATOR;
    await expect(plan(c)).rejects.toThrow(ArunaAuthError);
    expect(c.log).toEqual([]);
  });

  it("a vault already at the factory's version has nothing to migrate to", async () => {
    const c = new Chain();
    c.accounts.get(OLD)!.hash = CURRENT_VAULT_HASH;
    await expect(plan(c)).rejects.toThrow(/nothing to migrate/);
  });

  it("a factory making a version the SDK does not know is refused", async () => {
    const c = new Chain();
    c.factoryHash = "FutureVersion222";
    await expect(plan(c)).rejects.toThrow(/FutureVersion222/);
  });

  it("a bad name is refused", async () => {
    await expect(plan(new Chain(), { name: "Bad Name" })).rejects.toThrow(MigrationRefused);
  });

  it("a vault already at the new name with a different operator stops the run before any funds move", async () => {
    const c = new Chain();
    c.vaults.set(NEW, { hash: CURRENT_VAULT_HASH, owner: OWNER, operator: "someone-else.testnet", ceiling: ceilingRaw(), agents: new Map() });
    c.accounts.set(NEW, { hash: CURRENT_VAULT_HASH, storage: 800 });
    await expect(plan(c)).rejects.toThrow(/operator is someone-else.testnet, not company.testnet/);
    expect(c.log).toEqual([]);
  });

  it("an account at the new name that is not a vault is refused", async () => {
    const c = new Chain();
    c.accounts.set(NEW, { hash: null, storage: 10 });
    await expect(plan(c)).rejects.toThrow(/already exists and is not a copy/);
  });
});

describe("runMigration (AE8)", () => {
  it("moves agents, policies and funds, in the order of R36", async () => {
    const c = new Chain();
    const j = memoryJournal();
    const events: string[] = [];
    const r = await run(c, j, { onEvent: (e) => e.type === "sent" && events.push(e.step) });

    // R36: pause the two active agents, create the vault, add three agents, move funds, revoke last.
    expect(events.slice(0, 3)).toEqual(["pause", "pause", "create-vault"]);
    expect(events.filter((e) => e === "add-agent")).toHaveLength(3);
    expect(events.slice(-3)).toEqual(["revoke", "revoke", "revoke"]);
    expect(events.indexOf("add-agent")).toBeGreaterThan(events.indexOf("create-vault"));
    expect(events.indexOf("withdraw")).toBeGreaterThan(events.lastIndexOf("add-agent"));
    expect(events.indexOf("revoke")).toBeGreaterThan(events.lastIndexOf("deposit"));

    const next = c.vaults.get(NEW)!;
    expect([...next.agents.keys()].sort()).toEqual(["pk1", "pk2", "pk3"]);
    const old = c.vaults.get(OLD)!;
    for (const k of ["pk1", "pk2", "pk3"]) expect(next.agents.get(k)!.policy).toEqual(old.agents.get(k)!.policy);
    expect(next.agents.get("pk1")!.status).toBe("Active");
    expect(next.agents.get("pk3")!.status).toBe("Paused");
    expect(next.operator).toBe(OPERATOR);
    expect(next.owner).toBe(OWNER);
    expect(next.ceiling).toEqual(old.ceiling);

    // Funds moved; the old vault has no active agent and keeps only its storage.
    expect([...old.agents.values()].filter((a) => a.status !== "Revoked")).toEqual([]);
    expect(c.ft.get(NEW)).toBe(20_000_000n);
    expect(c.ft.get(OLD)).toBe(0n);
    expect(r.moved).toContainEqual({ token: USDC, amount: "20000000" });
    expect(BigInt(r.oldVaultRemaining.balanceYocto)).toBe(KEEP);
    expect(c.balances.get(NEW)).toBe(NEAR / 2n + (5n * NEAR - KEEP));
    expect(r.agentsCarried).toBe(3);
  });

  it("a paused agent and an auto-disabled agent both end Paused on the new vault, added and paused in one transaction", async () => {
    const c = new Chain([["a", "auto", "Paused", true, NEAR / 4n], ["b", "owner-paused", "Paused", false, NEAR / 4n], ["c", "live", "Active", false, NEAR / 4n]]);
    const p = await plan(c);
    expect(p.notes.join(" ")).toMatch(/auto-disabled becomes an owner pause/);
    await run(c, memoryJournal(), {}, p);
    const next = c.vaults.get(NEW)!;
    expect(next.agents.get("a")!.status).toBe("Paused");
    expect(next.agents.get("b")!.status).toBe("Paused");
    expect(next.agents.get("c")!.status).toBe("Active");
    // For the two that were paused, add_agent and pause_agent were ONE call: no state with the key active.
    const pairs = c.log.filter((l) => l.contract === NEW && l.method !== "transfer").map((l) => l.method);
    expect(pairs).toEqual(["add_agent", "pause_agent", "add_agent", "pause_agent", "add_agent"]);
  });

  it("a non-owner transport changes nothing even when handed a plan", async () => {
    const c = new Chain();
    const p = await plan(c);
    c.signer = OPERATOR;
    await expect(runMigration(p, { transport: c.transport(), journal: memoryJournal() })).rejects.toThrow(ArunaAuthError);
    expect(c.log).toEqual([]);
  });

  it("active coverage triggers the warning, and the run waits for the owner to accept it (R39)", async () => {
    const c = new Chain();
    c.coverages = [{ id: 0, vault: OLD, released: false }, { id: 1, vault: OLD, released: true }, { id: 2, vault: "other.testnet", released: false }];
    const p = await plan(c);
    expect(p.coverage).toEqual({ status: "active", coverageIds: [0] });
    await expect(run(c, memoryJournal(), {}, p)).rejects.toThrow(/Coverage stays bound to the old vault/);
    expect(c.log).toEqual([]);
    const r = await run(c, memoryJournal(), { acceptCoverageStays: true }, p);
    expect(r.coverage).toEqual({ status: "active", coverageIds: [0] });
    expect(c.vaults.has(NEW)).toBe(true);
  });

  it("a pool that cannot be read is not 'no coverage'", async () => {
    const c = new Chain();
    c.poolFails = true;
    const p = await plan(c);
    expect(p.coverage.status).toBe("unchecked");
    await expect(run(c, memoryJournal(), {}, p)).rejects.toThrow(MigrationRefused);
  });

  it("a registry from before coverage has no pool, so no coverage: that is 'none', not 'unchecked'", async () => {
    const c = new Chain();
    c.noPoolMethod = true;
    expect((await plan(c)).coverage).toEqual({ status: "none" });
    await run(c);
    expect(c.vaults.has(NEW)).toBe(true);
  });

  it("declining the first confirmation sends nothing", async () => {
    const c = new Chain();
    await expect(run(c, memoryJournal(), { confirm: async () => false })).rejects.toThrow(MigrationAborted);
    expect(c.log).toEqual([]);
  });

  it("confirm sees what will be signed, one entry per transaction, before each", async () => {
    const c = new Chain();
    const seen: string[] = [];
    await run(c, memoryJournal(), { confirm: async (s) => (seen.push(`${s.step}:${s.sends.map((x) => `${x.receiver}.${x.method}`).join("+")}`), true) });
    expect(seen[0]).toBe(`pause:${OLD}.pause_agent`);
    expect(seen).toContain(`create-vault:${FACTORY}.create_vault`);
    expect(seen).toContain(`add-agent:${NEW}.add_agent+${NEW}.pause_agent`);
    expect(seen.filter((s) => s.startsWith("withdraw")).length).toBe(2);
  });
});

describe("a run that stops halfway can be run again", () => {
  /** Stops before the first step matching `step`, like an owner answering no. */
  const stopBefore = (step: string): Partial<RunOptions> => ({ confirm: async (s) => s.step !== step });

  it("stopped after the agents were added: running again adds no agent twice and makes no second vault", async () => {
    const c = new Chain();
    const j = memoryJournal();
    await expect(run(c, j, stopBefore("withdraw"))).rejects.toThrow(MigrationAborted);
    expect(c.methods().filter((m) => m === "create_vault")).toHaveLength(1);
    const addsBefore = c.log.filter((l) => l.method === "add_agent").length;
    expect(addsBefore).toBe(3);

    await run(c, j);
    expect(c.methods().filter((m) => m === "create_vault")).toHaveLength(1);
    expect(c.log.filter((l) => l.method === "add_agent")).toHaveLength(3);
    expect(c.methods().filter((m) => m === "pause_agent")).toHaveLength(2 + 1); // two on the old vault, one in the paused agent's batch
    expect(c.ft.get(NEW)).toBe(20_000_000n);
  });

  it("while stopped there, a carried key cannot spend on the old vault: every carried agent is paused there", async () => {
    const c = new Chain();
    await expect(run(c, memoryJournal(), stopBefore("create-vault"))).rejects.toThrow(MigrationAborted);
    const old = c.vaults.get(OLD)!;
    expect(["pk1", "pk2", "pk3"].map((k) => old.agents.get(k)!.status)).toEqual(["Paused", "Paused", "Paused"]);
    expect(c.vaults.has(NEW)).toBe(false);
  });

  it("stopped after the withdrawal: running again deposits once and does not withdraw again", async () => {
    const c = new Chain();
    const j = memoryJournal();
    await expect(run(c, j, { confirm: async (s) => s.step !== "deposit" })).rejects.toThrow(MigrationAborted);
    const withdrawsBefore = c.methods().filter((m) => m === "withdraw_to_owner").length;
    expect(withdrawsBefore).toBe(1);

    await run(c, j);
    expect(c.methods().filter((m) => m === "withdraw_to_owner")).toHaveLength(2); // NEAR once, USDC once
    expect(c.log.filter((l) => l.method === "transfer")).toHaveLength(1);
    expect(c.log.filter((l) => l.method === "ft_transfer_call")).toHaveLength(1);
    expect(c.balances.get(NEW)).toBe(NEAR / 2n + (5n * NEAR - KEEP));
    expect(c.ft.get(NEW)).toBe(20_000_000n);
  });

  it("a process killed right after a transaction took effect resumes without moving anything twice", async () => {
    // A dry run finds the call after which to die: the NEAR withdrawal, before its hash could be journaled.
    const dry = new Chain();
    await run(dry);
    const dieAfter = dry.log.findIndex((l) => l.method === "withdraw_to_owner" && !l.args.token) + 1;

    const c = new Chain();
    const j = memoryJournal();
    c.crashAfter = dieAfter;
    await expect(run(c, j)).rejects.toThrow(/process died/);
    c.crashAfter = null;
    expect(j.current()!.funds[0].withdraw).toEqual({ state: "sending" });

    // The journal says "sending" with no hash: the run cannot know, so it stops instead of withdrawing again.
    await expect(run(c, j)).rejects.toThrow(MigrationNeedsReview);
    expect(c.log.filter((l) => l.method === "withdraw_to_owner")).toHaveLength(1);
  });

  it("an unconfirmable withdrawal stops the run; one that failed is asked for again", async () => {
    const c = new Chain();
    const j = memoryJournal();
    await expect(run(c, j, { confirm: async (s) => s.step !== "deposit" })).rejects.toThrow(MigrationAborted);
    const withdrawal = j.current()!.funds[0];
    const tx = withdrawal.withdraw!.tx!;
    const nearWithdrawals = () => c.log.filter((l) => l.method === "withdraw_to_owner" && !l.args.token).length;

    // The node cannot say: stop, send nothing.
    c.txStatus.set(tx, "unknown");
    const sent = c.log.length;
    await expect(run(c, j)).rejects.toThrow(MigrationNeedsReview);
    expect(c.log.length).toBe(sent);

    // It failed, so the funds never left: put them back as a failed withdrawal would have left them.
    const moved = BigInt(withdrawal.moved!);
    c.balances.set(OLD, c.balances.get(OLD)! + moved);
    c.balances.set(OWNER, c.balances.get(OWNER)! - moved);
    c.txStatus.set(tx, "failed");
    await run(c, j);
    expect(nearWithdrawals()).toBe(2);
    expect(c.balances.get(NEW)).toBe(NEAR / 2n + moved);
  });

  it("a journal for other vaults is refused", async () => {
    const c = new Chain();
    const other: MigrationJournal = { version: 1, oldVault: "x.testnet", newVault: "y.testnet", factory: FACTORY, owner: OWNER, startedAt: "", agents: [], funds: [] };
    await expect(run(c, memoryJournal(other))).rejects.toThrow(/journal is for x.testnet/);
  });
});

describe("old vault versions", () => {
  it("a v1-shaped old vault is withdrawn from without an attached deposit; v2 and later attach exactly 1 yoctoNEAR", async () => {
    for (const [version, deposit] of [["v1", 0n], ["v2", 1n]] as const) {
      const c = new Chain([["pk1", "a", "Active", false, NEAR]]);
      c.accounts.get(OLD)!.hash = hashOf(version);
      c.vaults.get(OLD)!.hash = hashOf(version);
      await run(c);
      const w = c.log.filter((l) => l.contract === OLD && l.method === "withdraw_to_owner");
      expect(w.length).toBeGreaterThan(0);
      for (const l of w) expect(l.deposit).toBe(deposit);
      // The calls that need no deposit on any version never carry one.
      for (const l of c.log.filter((x) => x.contract === OLD && ["pause_agent", "revoke_agent"].includes(x.method))) expect(l.deposit).toBe(0n);
    }
  });

  it("a vault with no fungible token moves NEAR only and touches no token", async () => {
    const c = new Chain([["pk1", "a", "Active", false, NEAR]]);
    c.vaults.get(OLD)!.ceiling.tokens = [c.vaults.get(OLD)!.ceiling.tokens[0]];
    c.vaults.get(OLD)!.agents.get("pk1")!.policy.limits = [c.vaults.get(OLD)!.agents.get("pk1")!.policy.limits[0]];
    await run(c);
    expect(c.log.filter((l) => l.contract === USDC)).toEqual([]);
    expect(c.balances.get(NEW)).toBeGreaterThan(NEAR / 2n);
  });
});
