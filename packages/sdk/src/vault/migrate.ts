// Moves a vault to the current vault version (plan U15, R36 to R39; docs/DECISIONS.md D-65).
//
// Vaults are immutable, so "upgrading" one means making a new vault and moving its agents and funds. The
// flow (R36): 1 pause every agent being carried over on the OLD vault, so no key can spend on both;
// 2 create the new vault with the same owner, operator and ceiling; 3 re-add each carried agent with
// its key, label and policy; 4 move the funds; 5 revoke the carried agents on the old vault.
//
// `planMigration` only reads, and refuses before any step for every reason that can be known in advance.
// `runMigration` is resumable: each step reads chain state first and skips work already done. Funds
// are the exception (KTD10): withdrawn NEAR lands in the owner's general balance and a vault deposit
// emits no event, so a journal records what was planned and the hash of each fund transaction. A
// transaction is journaled as "sending" BEFORE it is sent, so a crash between sending and recording is
// never mistaken for "not sent": the run stops and asks for a look instead of moving anything twice.
import type { Network } from "@aruna/rpc";
import { Pool } from "../coverage/pool.js";
import { readVault, type AgentView, type VaultView } from "../vault-view.js";
import { OwnerVault, rawPolicy, rawToken, type Policy } from "./clients.js";
import { ArunaAuthError, VaultVersionError, type MigrationTransport } from "./transport.js";
import { CAPABILITIES, KNOWN_VAULT_VERSIONS, type VaultVersion } from "./versions.js";

/** The old vault keeps its storage cost plus this much, so a withdrawal never trips the storage requirement. */
export const MIGRATION_MARGIN_YOCTO = 10n ** 21n; // 0.001 NEAR
/** NEAR's storage price per byte, in yoctoNEAR. */
export const STORAGE_BYTE_YOCTO = 10n ** 19n;
/** The repo's own scripts register an account at a token with this much when the token states no minimum. */
const FALLBACK_STORAGE_REGISTRATION = 12_500_000_000_000_000_000_000n; // 0.0125 NEAR

/** Refused before anything was sent: the situation is known and the owner can fix it. */
export class MigrationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationRefused";
  }
}
/** A transaction may or may not have happened and the journal cannot tell. Nothing further was sent. */
export class MigrationNeedsReview extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationNeedsReview";
  }
}
/** The caller's `confirm` declined a step. The journal and the chain keep what was done; run again to resume. */
export class MigrationAborted extends Error {
  constructor(readonly step: string) {
    super(`migration stopped before: ${step}`);
    this.name = "MigrationAborted";
  }
}

export interface JournalTx {
  state: "sending" | "sent";
  tx?: string;
}
export interface JournalFund {
  /** "near", or a NEP-141 contract. */
  token: string;
  /** What the plan meant to move, fixed when the journal was made. */
  planned: string;
  /** What the withdrawal actually moved; the deposit moves exactly this. */
  moved?: string;
  withdraw?: JournalTx;
  deposit?: JournalTx;
}
export interface MigrationJournal {
  version: 1;
  oldVault: string;
  newVault: string;
  factory: string;
  owner: string;
  startedAt: string;
  /** Each carried agent as it was BEFORE step 1 paused it. */
  agents: { publicKey: string; label: string; statusBefore: "Active" | "Paused"; autoDisabledBefore: boolean }[];
  funds: JournalFund[];
}
/** Where the journal lives: a file for the CLI, `localStorage` for the console, memory in tests. */
export interface JournalStore {
  load(): Promise<MigrationJournal | null>;
  save(journal: MigrationJournal): Promise<void>;
}
export function memoryJournal(initial: MigrationJournal | null = null): JournalStore & { current(): MigrationJournal | null } {
  let j = initial ? structuredClone(initial) : null;
  return {
    async load() {
      return j ? structuredClone(j) : null;
    },
    async save(next) {
      j = structuredClone(next);
    },
    current: () => (j ? structuredClone(j) : null),
  };
}

export type CoverageNotice =
  | { status: "none" }
  /** Coverage on this vault that has not been released. It stays bound to the OLD vault and is not moved (R39). */
  | { status: "active"; coverageIds: number[] }
  /** The pool could not be read. Treated like active: the owner must acknowledge it. */
  | { status: "unchecked"; reason: string };

export interface CarriedAgent {
  publicKey: string;
  label: string;
  statusBefore: "Active" | "Paused";
  autoDisabledBefore: boolean;
  policy: Policy;
}

export interface MigrationPlan {
  oldVault: string;
  /** The name part; the account is `<name>.<factory>`. */
  name: string;
  newVault: string;
  factory: string;
  owner: string;
  operator: string | null;
  oldVersion: VaultVersion;
  /** The version the factory makes now, which the SDK knows. */
  targetVersion: VaultVersion;
  /** The owner's limits, in the shape `create_vault` takes. */
  ceiling: Record<string, unknown>;
  minDepositYocto: string;
  agents: CarriedAgent[];
  /** Agents already revoked on the old vault: not carried. */
  revokedAgents: number;
  /** Agents whose reservations are in flight: a spend sent before the pause may still settle. */
  agentsWithReservations: number;
  funds: { near: { balanceYocto: string; keepYocto: string; movableYocto: string }; tokens: { token: string; balance: string }[] };
  coverage: CoverageNotice;
  newVaultState: "absent" | "ready";
  /** What the owner should know before confirming. */
  notes: string[];
}

export interface PlanOptions {
  oldVault: string;
  /** The factory that makes the new vault, for example factory2.arunafi.testnet. */
  factory: string;
  /** The new vault's name; its account is `<name>.<factory>`. */
  name: string;
  /** Signs as the owner. */
  transport: MigrationTransport;
  network?: Network;
  /** The old vault's public state. Defaults to `readVault`; a test passes its own. */
  readOld?: (vault: string) => Promise<VaultView>;
  /** The journal of an earlier run, so original agent statuses are not lost on a resume. */
  journal?: MigrationJournal | null;
}

export interface StepInfo {
  step: "pause" | "create-vault" | "add-agent" | "withdraw" | "register" | "deposit" | "revoke";
  title: string;
  /** What will be signed: one entry per transaction. */
  sends: { receiver: string; method: string; depositYocto: string }[];
}
export type MigrationEvent = { type: "step-skipped"; step: StepInfo["step"]; why: string } | { type: "sent"; step: StepInfo["step"]; title: string; tx: string };

export interface RunOptions {
  transport: MigrationTransport;
  journal: JournalStore;
  network?: Network;
  /** Called before each transaction is signed. Return false to stop; the run can be resumed. */
  confirm?: (step: StepInfo) => Promise<boolean>;
  onEvent?: (e: MigrationEvent) => void;
  /** Active coverage stays with the old vault (R39). The run refuses unless the owner has said so. */
  acceptCoverageStays?: boolean;
}

export interface MigrationResult {
  newVault: string;
  agentsCarried: number;
  txs: { step: StepInfo["step"]; tx: string }[];
  moved: { token: string; amount: string }[];
  /** What is left on the old vault and why (R37). */
  oldVaultRemaining: { balanceYocto: string; reason: string };
  coverage: CoverageNotice;
}

// ---- helpers ------------------------------------------------------------------------------------

const NAME = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/;
const tokenKey = (t: unknown): string => (t === "near" ? "near" : typeof t === "object" && t !== null && "ft" in t ? `ft:${(t as { ft: string }).ft}` : String(t));
const sortBy = <T>(xs: T[], k: (x: T) => string) => [...xs].sort((a, b) => k(a).localeCompare(k(b)));

type RawPolicy = { limits: { token: unknown; max_per_tx: string; daily_cap: string }[]; max_slippage_bps: number; allowed_targets: string[]; max_risk_class: string };
const canonPolicy = (p: RawPolicy) => ({
  limits: sortBy(p.limits.map((l) => ({ token: tokenKey(l.token), max_per_tx: String(l.max_per_tx), daily_cap: String(l.daily_cap) })), (l) => l.token),
  max_slippage_bps: p.max_slippage_bps,
  allowed_targets: [...p.allowed_targets].sort(),
  max_risk_class: p.max_risk_class,
});
type RawCeiling = { tokens: { token: unknown; max_per_tx: string; daily_total: string }[]; max_risk_class: string; allowed_targets: string[]; agent_allowance: string };
const canonCeiling = (c: RawCeiling) => ({
  tokens: sortBy(c.tokens.map((t) => ({ token: tokenKey(t.token), max_per_tx: String(t.max_per_tx), daily_total: String(t.daily_total) })), (t) => t.token),
  max_risk_class: c.max_risk_class,
  allowed_targets: [...c.allowed_targets].sort(),
  agent_allowance: String(c.agent_allowance),
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function toPolicy(a: AgentView): Policy {
  return {
    limits: a.policy.limits ?? [{ token: "near", maxPerTx: a.policy.maxPerTx, dailyCap: a.policy.dailyCap }],
    maxSlippageBps: a.policy.maxSlippageBps,
    allowedTargets: a.policy.allowedTargets,
    maxRiskClass: a.policy.maxRiskClass as Policy["maxRiskClass"],
  };
}

function rawCeilingOf(v: VaultView): Record<string, unknown> {
  const c = v.ceiling;
  if (!c) throw new MigrationRefused(`${v.vault} does not return its ceiling, so the new vault's limits cannot be copied`);
  const tokens = c.tokens ?? [{ token: "near", maxPerTx: c.maxPerTx, dailyTotal: c.dailyTotal }];
  return {
    tokens: tokens.map((t) => ({ token: rawToken(t.token), max_per_tx: t.maxPerTx, daily_total: t.dailyTotal })),
    max_risk_class: c.maxRiskClass,
    allowed_targets: c.allowedTargets,
    agent_allowance: c.agentAllowance,
  };
}

async function accountOrNull(t: MigrationTransport, id: string) {
  try {
    return await t.account(id);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(m)) return null;
    throw e;
  }
}

type RawAgent = { label: string; status: "Active" | "Paused" | "Revoked"; policy: RawPolicy; auto_disabled?: boolean };
const rawAgents = (t: MigrationTransport, vault: string) => t.view<[string, RawAgent][]>(vault, "get_agents", {});

// ---- plan ---------------------------------------------------------------------------------------

export async function planMigration(o: PlanOptions): Promise<MigrationPlan> {
  const t = o.transport;
  if (!NAME.test(o.name)) throw new MigrationRefused(`"${o.name}" is not a valid vault name (lowercase letters, digits, - and _)`);
  const newVault = `${o.name}.${o.factory}`;
  if (newVault === o.oldVault) throw new MigrationRefused("the new vault would be the old one");

  // 1. A vault this SDK does not know is refused before anything else, naming its hash (AE9, R38).
  const old = new OwnerVault({ vaultId: o.oldVault, transport: t, network: o.network });
  const oldVersion = await old.vaultVersion();

  // 2. The factory's current version must be one the SDK knows, and different from the old one.
  const fcfg = await t.view<{ vault_code_hash: string; min_deposit: string }>(o.factory, "get_config", {});
  const targetVersion = KNOWN_VAULT_VERSIONS[fcfg.vault_code_hash];
  if (!targetVersion) throw new VaultVersionError(`${o.factory} makes vaults from ${fcfg.vault_code_hash}, which this SDK does not support; update the SDK before migrating to it`);
  const oldHash = (await t.account(o.oldVault)).globalContractHash;
  if (oldHash === fcfg.vault_code_hash) throw new MigrationRefused(`${o.oldVault} already runs ${oldVersion}, the version ${o.factory} makes; there is nothing to migrate to`);

  // 3. Only the owner can withdraw, so only the owner can migrate. Checked here so that nothing is
  // changed by an operator who could pause and add agents but not finish.
  const view = await (o.readOld ?? ((v) => readVault(v, { network: o.network })))(o.oldVault);
  if (view.owner !== t.signerId) throw new ArunaAuthError(`${t.signerId} is not the owner of ${o.oldVault} (${view.owner}); only the owner can migrate it`);
  if (view.fullAccessKeys > 0) throw new MigrationRefused(`${o.oldVault} has ${view.fullAccessKeys} full-access key(s); that is not a vault Aruna made`);

  // 4. Agents. A resumed run keeps each agent's status from before step 1 (the journal).
  const carriedView = view.agents.filter((a) => a.status !== "Revoked" || o.journal?.agents.some((j) => j.publicKey === a.publicKey));
  const agents: CarriedAgent[] = carriedView.map((a) => {
    const j = o.journal?.agents.find((x) => x.publicKey === a.publicKey);
    return {
      publicKey: a.publicKey,
      label: a.label,
      statusBefore: j?.statusBefore ?? (a.status === "Active" ? "Active" : "Paused"),
      autoDisabledBefore: j?.autoDisabledBefore ?? a.autoDisabled,
      policy: toPolicy(a),
    };
  });
  const revokedAgents = view.agents.filter((a) => a.status === "Revoked" && !o.journal?.agents.some((j) => j.publicKey === a.publicKey)).length;
  const agentsWithReservations = view.agents.filter((a) => (a.usageByToken ?? []).some((u) => BigInt(u.reserved) > 0n)).length;

  // 5. Funds.
  const cfg = await t.view<{ registry: string }>(o.oldVault, "get_config", {});
  const acct = await t.account(o.oldVault);
  const keep = BigInt(acct.storageUsage) * STORAGE_BYTE_YOCTO + MIGRATION_MARGIN_YOCTO;
  const balance = BigInt(acct.amount);
  const tokens: { token: string; balance: string }[] = [];
  for (const c of view.ceiling?.tokens ?? []) {
    if (c.token === "near") continue;
    tokens.push({ token: c.token, balance: await t.view<string>(c.token, "ft_balance_of", { account_id: o.oldVault }) });
  }

  // 6. Coverage stays with the old vault (R39). If it cannot be read, that is not "none".
  let coverage: CoverageNotice;
  try {
    // A registry from before coverage has no `pool` method at all: there is no pool, so no coverage.
    // Any other failure is not "none".
    const poolId = await t.view<string | null>(cfg.registry, "pool", {}).catch((e: unknown) => {
      if (/method.{0,20}not found|MethodNotFound|no such method/i.test(e instanceof Error ? e.message : String(e))) return null;
      throw e;
    });
    if (!poolId) coverage = { status: "none" };
    else {
      const live = (await new Pool({ pool: poolId, transport: t }).coverages({ vault: o.oldVault })).filter((c) => !c.released);
      coverage = live.length ? { status: "active", coverageIds: live.map((c) => c.id) } : { status: "none" };
    }
  } catch (e) {
    coverage = { status: "unchecked", reason: e instanceof Error ? e.message : String(e) };
  }

  // 7. A vault already at the new name must be this migration's own, or the run stops (before funds move).
  const ceiling = rawCeilingOf(view);
  const existing = await accountOrNull(t, newVault);
  let newVaultState: MigrationPlan["newVaultState"] = "absent";
  if (existing) {
    const mismatches: string[] = [];
    if (existing.globalContractHash !== fcfg.vault_code_hash) mismatches.push(`runs ${existing.globalContractHash ?? "no global contract by hash"}, not ${fcfg.vault_code_hash}`);
    else {
      const nc = await t.view<{ owner: string; operator: string | null; ceiling: RawCeiling }>(newVault, "get_config", {});
      if (nc.owner !== view.owner) mismatches.push(`owner is ${nc.owner}, not ${view.owner}`);
      if ((nc.operator ?? null) !== (view.operator ?? null)) mismatches.push(`operator is ${nc.operator ?? "none"}, not ${view.operator ?? "none"}`);
      if (!same(canonCeiling(nc.ceiling), canonCeiling(ceiling as unknown as RawCeiling))) mismatches.push("its ceiling differs from the old vault's");
    }
    if (mismatches.length) throw new MigrationRefused(`${newVault} already exists and is not a copy of ${o.oldVault}: ${mismatches.join("; ")}. Choose another name; nothing was sent.`);
    newVaultState = "ready";
  }

  const notes: string[] = [];
  if (agents.some((a) => a.autoDisabledBefore)) notes.push("An agent the vault auto-disabled becomes an owner pause on the new vault; resume it there if you want it back.");
  if (agents.some((a) => a.statusBefore === "Paused")) notes.push("Agents that were paused stay paused on the new vault.");
  if (agentsWithReservations > 0) notes.push("Some agents have spends in flight; one sent before the pause can still settle on the old vault after the funds move.");
  notes.push("Agents keep their keys: after the move they only need the new vault id. Their daily usage and recorded exposure start again.");

  return {
    oldVault: o.oldVault,
    name: o.name,
    newVault,
    factory: o.factory,
    owner: view.owner,
    operator: view.operator,
    oldVersion,
    targetVersion,
    ceiling,
    minDepositYocto: String(fcfg.min_deposit),
    agents,
    revokedAgents,
    agentsWithReservations,
    funds: { near: { balanceYocto: balance.toString(), keepYocto: keep.toString(), movableYocto: (balance > keep ? balance - keep : 0n).toString() }, tokens },
    coverage,
    newVaultState,
    notes,
  };
}

// ---- run ----------------------------------------------------------------------------------------

export async function runMigration(plan: MigrationPlan, o: RunOptions): Promise<MigrationResult> {
  const t = o.transport;
  if (t.signerId !== plan.owner) throw new ArunaAuthError(`${t.signerId} is not the owner of ${plan.oldVault} (${plan.owner})`);
  if (plan.coverage.status !== "none" && !o.acceptCoverageStays) {
    const what = plan.coverage.status === "active" ? `active coverage ${plan.coverage.coverageIds.join(", ")}` : `coverage that could not be checked (${plan.coverage.reason})`;
    throw new MigrationRefused(`${plan.oldVault} has ${what}. Coverage stays bound to the old vault and is not moved; acknowledge that to continue. Nothing was sent.`);
  }

  // The journal: made before step 1, because step 1 changes the statuses it records.
  let journal = await o.journal.load();
  if (journal && (journal.oldVault !== plan.oldVault || journal.newVault !== plan.newVault)) {
    throw new MigrationRefused(`the journal is for ${journal.oldVault} -> ${journal.newVault}, not ${plan.oldVault} -> ${plan.newVault}; remove it or use its names`);
  }
  if (!journal) {
    journal = {
      version: 1,
      oldVault: plan.oldVault,
      newVault: plan.newVault,
      factory: plan.factory,
      owner: plan.owner,
      startedAt: new Date().toISOString(),
      agents: plan.agents.map((a) => ({ publicKey: a.publicKey, label: a.label, statusBefore: a.statusBefore, autoDisabledBefore: a.autoDisabledBefore })),
      funds: [{ token: "near", planned: plan.funds.near.movableYocto }, ...plan.funds.tokens.map((f) => ({ token: f.token, planned: f.balance }))],
    };
    await o.journal.save(journal);
  }
  const J = journal;
  const save = () => o.journal.save(J);

  const txs: MigrationResult["txs"] = [];
  const old = new OwnerVault({ vaultId: plan.oldVault, transport: t, network: o.network });
  const next = new OwnerVault({ vaultId: plan.newVault, transport: t, network: o.network });
  const oldDeposit = CAPABILITIES[plan.oldVersion].yoctoOnOwnerMethods ? 1n : 0n;

  // `beforeSend` runs after the owner confirmed and immediately before the transaction goes out: that is
  // where a fund transaction is journaled as "sending". A step the owner declined was never "sending".
  const sign = async (info: StepInfo, fn: () => Promise<{ tx: string }>, beforeSend?: () => Promise<void>): Promise<string> => {
    if (o.confirm && !(await o.confirm(info))) throw new MigrationAborted(info.title);
    await beforeSend?.();
    const { tx } = await fn();
    txs.push({ step: info.step, tx });
    o.onEvent?.({ type: "sent", step: info.step, title: info.title, tx });
    return tx;
  };
  const skip = (step: StepInfo["step"], why: string) => o.onEvent?.({ type: "step-skipped", step, why });

  // Step 1: pause every carried agent on the old vault.
  const oldNow = await rawAgents(t, plan.oldVault);
  let paused = 0;
  for (const a of plan.agents) {
    const cur = oldNow.find(([k]) => k === a.publicKey)?.[1];
    if (!cur || cur.status !== "Active") continue;
    await sign({ step: "pause", title: `pause ${a.label} on ${plan.oldVault}`, sends: [{ receiver: plan.oldVault, method: "pause_agent", depositYocto: "0" }] }, () => old.pauseAgent(a.publicKey));
    paused++;
  }
  if (!paused) skip("pause", "every carried agent is already paused on the old vault");

  // Step 2: the new vault. `plan` already checked that one at this name is a true copy.
  const have = await accountOrNull(t, plan.newVault);
  if (have) skip("create-vault", `${plan.newVault} already exists`);
  else {
    await sign(
      { step: "create-vault", title: `create ${plan.newVault}`, sends: [{ receiver: plan.factory, method: "create_vault", depositYocto: plan.minDepositYocto }] },
      () => t.call(plan.factory, "create_vault", { name: plan.name, owner: plan.owner, operator: plan.operator, ceiling: plan.ceiling }, { depositYocto: BigInt(plan.minDepositYocto), tgas: 150n }),
    );
    if (!(await accountOrNull(t, plan.newVault))) throw new MigrationNeedsReview(`create_vault was sent but ${plan.newVault} does not exist; the factory refunds a failed creation. Check the transaction, then run again.`);
  }

  // Step 3: re-add each carried agent. One that was paused before is added and paused in ONE transaction,
  // so it is never active on the new vault, not even for a block.
  const newNow = await rawAgents(t, plan.newVault);
  for (const a of plan.agents) {
    const raw = rawPolicy(a.policy);
    const there = newNow.find(([k]) => k === a.publicKey)?.[1];
    if (there) {
      if (!same(canonPolicy(there.policy), canonPolicy(raw as unknown as RawPolicy))) throw new MigrationRefused(`${plan.newVault} already has ${a.label} (${a.publicKey}) with a different policy; nothing more was sent`);
      if (a.statusBefore === "Paused" && there.status === "Active") {
        await sign({ step: "add-agent", title: `pause ${a.label} on ${plan.newVault}`, sends: [{ receiver: plan.newVault, method: "pause_agent", depositYocto: "0" }] }, () => next.pauseAgent(a.publicKey));
      } else skip("add-agent", `${a.label} is already on ${plan.newVault}`);
      continue;
    }
    const add = { method: "add_agent", args: { public_key: a.publicKey, label: a.label, policy: raw }, depositYocto: 1n, tgas: 30n };
    if (a.statusBefore === "Paused") {
      await sign(
        { step: "add-agent", title: `add ${a.label} to ${plan.newVault}, paused`, sends: [{ receiver: plan.newVault, method: "add_agent", depositYocto: "1" }, { receiver: plan.newVault, method: "pause_agent", depositYocto: "0" }] },
        () => t.callBatch(plan.newVault, [add, { method: "pause_agent", args: { public_key: a.publicKey }, depositYocto: 0n, tgas: 30n }]),
      );
    } else {
      await sign({ step: "add-agent", title: `add ${a.label} to ${plan.newVault}`, sends: [{ receiver: plan.newVault, method: "add_agent", depositYocto: "1" }] }, () => next.createAgent({ publicKey: a.publicKey, label: a.label, policy: a.policy }));
    }
  }

  // Step 4: funds, token by token, each through the journal.
  const moved: MigrationResult["moved"] = [];
  for (const f of J.funds) {
    const amount = await moveFund(f);
    if (amount > 0n) moved.push({ token: f.token, amount: amount.toString() });
  }

  async function confirmed(tx: JournalTx | undefined, what: string): Promise<"done" | "redo" | "fresh"> {
    if (!tx) return "fresh";
    if (tx.state === "sending" && !tx.tx) throw new MigrationNeedsReview(`${what} was about to be sent, and the journal does not say whether it was. Look at the owner's recent transactions, then edit or remove the journal entry. Nothing further was sent.`);
    const s = await t.txStatus(tx.tx!);
    if (s === "success") return "done";
    if (s === "failed") return "redo";
    throw new MigrationNeedsReview(`${what} (${tx.tx}) cannot be confirmed right now. Try again in a moment. Nothing further was sent.`);
  }

  async function moveFund(f: JournalFund): Promise<bigint> {
    const label = f.token === "near" ? "NEAR" : f.token;
    // 4a. out of the old vault, into the owner's account.
    let w = await confirmed(f.withdraw, `the withdrawal of ${label}`);
    if (w === "redo") {
      delete f.withdraw;
      delete f.moved;
      await save();
      w = "fresh";
    }
    if (w === "fresh") {
      // Capped at what is there now, so a retry after a partial move never asks for more than exists.
      const have = f.token === "near" ? await nearMovable() : BigInt(await t.view<string>(f.token, "ft_balance_of", { account_id: plan.oldVault }));
      const amount = have < BigInt(f.planned) ? have : BigInt(f.planned);
      if (amount <= 0n) {
        f.moved = "0";
        await save();
        skip("withdraw", `nothing to move in ${label}`);
        return 0n;
      }
      // The owner must be registered at the token to receive it (NEP-145); the owner pays.
      if (f.token !== "near") await registerAt(f.token, plan.owner);
      f.moved = amount.toString();
      const args = f.token === "near" ? { amount: f.moved } : { amount: f.moved, token: rawToken(f.token) };
      const tx = await sign(
        { step: "withdraw", title: `withdraw ${f.moved} ${label} from ${plan.oldVault} to ${plan.owner}`, sends: [{ receiver: plan.oldVault, method: "withdraw_to_owner", depositYocto: oldDeposit.toString() }] },
        () => t.call(plan.oldVault, "withdraw_to_owner", args, { depositYocto: oldDeposit, tgas: f.token === "near" ? 30n : 60n }),
        async () => {
          f.withdraw = { state: "sending" };
          await save();
        },
      );
      f.withdraw = { state: "sent", tx };
      await save();
    } else skip("withdraw", `${label} was already withdrawn`);

    const amount = BigInt(f.moved ?? "0");
    if (amount === 0n) return 0n;

    // 4b. into the new vault.
    let d = await confirmed(f.deposit, `the deposit of ${label}`);
    if (d === "redo") {
      delete f.deposit;
      await save();
      d = "fresh";
    }
    if (d === "done") {
      skip("deposit", `${label} was already deposited`);
      return amount;
    }
    if (f.token !== "near") await registerAt(f.token, plan.newVault);
    const mark = async () => {
      f.deposit = { state: "sending" };
      await save();
    };
    const tx =
      f.token === "near"
        ? await sign({ step: "deposit", title: `send ${f.moved} NEAR to ${plan.newVault}`, sends: [{ receiver: plan.newVault, method: "transfer", depositYocto: f.moved! }] }, () => t.transfer(plan.newVault, amount), mark)
        : await sign(
            { step: "deposit", title: `send ${f.moved} ${label} to ${plan.newVault}`, sends: [{ receiver: f.token, method: "ft_transfer_call", depositYocto: "1" }] },
            () => t.call(f.token, "ft_transfer_call", { receiver_id: plan.newVault, amount: f.moved, msg: "migration" }, { depositYocto: 1n, tgas: 100n }),
            mark,
          );
    f.deposit = { state: "sent", tx };
    await save();
    return amount;
  }

  async function nearMovable(): Promise<bigint> {
    const a = await t.account(plan.oldVault);
    const keep = BigInt(a.storageUsage) * STORAGE_BYTE_YOCTO + MIGRATION_MARGIN_YOCTO;
    const bal = BigInt(a.amount);
    return bal > keep ? bal - keep : 0n;
  }

  /** NEP-145: an account must be registered at a token to hold it. The owner pays. */
  async function registerAt(token: string, account: string) {
    const holder = await t.view<unknown | null>(token, "storage_balance_of", { account_id: account });
    if (holder) return;
    let min = FALLBACK_STORAGE_REGISTRATION;
    try {
      min = BigInt((await t.view<{ min: string }>(token, "storage_balance_bounds", {})).min);
    } catch {
      /* the token states no bounds: use the amount this repo's scripts use */
    }
    await sign(
      { step: "register", title: `register ${account} at ${token}`, sends: [{ receiver: token, method: "storage_deposit", depositYocto: min.toString() }] },
      () => t.call(token, "storage_deposit", { account_id: account, registration_only: true }, { depositYocto: min, tgas: 30n }),
    );
  }

  // Step 5: revoke the carried agents on the old vault. After this no key reaches it (R37).
  const oldAfter = await rawAgents(t, plan.oldVault);
  let revoked = 0;
  for (const a of plan.agents) {
    const cur = oldAfter.find(([k]) => k === a.publicKey)?.[1];
    if (!cur || cur.status === "Revoked") continue;
    await sign({ step: "revoke", title: `revoke ${a.label} on ${plan.oldVault}`, sends: [{ receiver: plan.oldVault, method: "revoke_agent", depositYocto: "0" }] }, () => old.revokeAgent(a.publicKey));
    revoked++;
  }
  if (!revoked) skip("revoke", "every carried agent is already revoked on the old vault");

  const left = await t.account(plan.oldVault);
  return {
    newVault: plan.newVault,
    agentsCarried: plan.agents.length,
    txs,
    moved,
    oldVaultRemaining: { balanceYocto: left.amount, reason: "the storage the old vault must keep (its state stays on chain), plus a small margin" },
    coverage: plan.coverage,
  };
}
