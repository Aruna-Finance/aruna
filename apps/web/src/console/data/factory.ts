import { isValidAccountId } from "@aruna/rpc";
import type { ChainReads } from "../wallet-transport";

// Self-serve vault creation (plan U5, R15 to R17). Everything here is pure or reads the public testnet RPC.
// The console never classifies a target (CLAUDE.md rule 10): a target is offered only when the registry already
// holds a class for it, and the registry is the one the factory itself reports.

/** The current factory. It creates vaults at the current version, by global hash, with no full-access key. */
export const FACTORY = "factory2.arunafi.testnet";

/** Where to get testnet NEAR when the balance is short (docs.near.org Token Faucet, with near-faucet.io as the backup). */
export const FAUCET_URL = "https://docs.near.org/getting-started/faucet";
export const FAUCET_BACKUP_URL = "https://near-faucet.io/";

/** create_vault runs three promises; the README scripts give it 150 Tgas. */
export const GAS_CREATE_VAULT = "150000000000000";
/** Held back from the balance check for gas. A conservative estimate, not a quote: 150 Tgas costs about 0.015 NEAR. */
export const GAS_RESERVE_YOCTO = 50n * 10n ** 21n;
/** Below this the vault is shown as not yet funded. Our choice: enough for several 0.1 NEAR playground swaps. */
export const FUNDED_YOCTO = 10n ** 24n;

/** Targets offered before the indexer can list every classified one. Each is checked against the registry. */
export const SEED_TARGETS = ["swap.arunafi.testnet", "drift-target.arunafi.testnet"] as const;

const CLASS_ORDER = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"] as const;
export type RiskClassName = (typeof CLASS_ORDER)[number];

export interface FactoryInfo {
  registry: string;
  minDepositYocto: bigint;
  vaultCodeHash: string;
}

export async function readFactory(reads: ChainReads, factory = FACTORY): Promise<FactoryInfo> {
  const c = await reads.view<{ registry: string; min_deposit: string; vault_code_hash: string }>(factory, "get_config", {});
  return { registry: c.registry, minDepositYocto: BigInt(c.min_deposit), vaultCodeHash: c.vault_code_hash };
}

/** One DNS-like label: lowercase letters and digits, with single - or _ between them. */
export function vaultNameError(name: string, factory = FACTORY): string | null {
  if (name === "") return "Enter a name for the vault.";
  if (!/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(name)) return "Use lowercase letters and digits, with single - or _ between them. No dots.";
  if (!isValidAccountId(`${name}.${factory}`)) return `The full account ${name}.${factory} is too long. Use a shorter name.`;
  return null;
}

export const vaultIdOf = (name: string, factory = FACTORY) => `${name}.${factory}`;

/** True when the account already exists, so create_vault would fail after the wallet prompt. */
export async function vaultTaken(reads: { balance(id: string): Promise<bigint | null> }, name: string, factory = FACTORY): Promise<boolean> {
  return (await reads.balance(vaultIdOf(name, factory))) !== null;
}

export interface FundsPlan {
  ok: boolean;
  /** Deposit plus the gas reserve. */
  neededYocto: bigint;
  shortfallYocto: bigint;
  /** Below the factory's minimum: the contract would refuse with ARUNA_DEPOSIT_TOO_SMALL. */
  depositTooSmall: boolean;
}

/** AE4: a short balance, or a deposit under the minimum, builds no transaction. */
export function planFunds(o: { balanceYocto: bigint; depositYocto: bigint; minDepositYocto: bigint; reserveYocto?: bigint }): FundsPlan {
  const needed = o.depositYocto + (o.reserveYocto ?? GAS_RESERVE_YOCTO);
  const shortfall = needed > o.balanceYocto ? needed - o.balanceYocto : 0n;
  const depositTooSmall = o.depositYocto < o.minDepositYocto;
  return { ok: shortfall === 0n && !depositTooSmall, neededYocto: needed, shortfallYocto: shortfall, depositTooSmall };
}

export interface TargetOption {
  target: string;
  class: RiskClassName;
  /** A frozen target refuses every spend until its drift report is settled. */
  frozen: boolean;
  classifiedAtBlock: number;
}

/** The registry's record for the target, or null when the registry has none. The console never writes a class. */
export async function classifiedTarget(reads: ChainReads, registry: string, target: string): Promise<TargetOption | null> {
  if (!isValidAccountId(target)) return null;
  const r = await reads.view<{ class: string; frozen: boolean; classified_at_block: number } | null>(registry, "get_class", { target });
  if (!r || !(CLASS_ORDER as readonly string[]).includes(r.class)) return null;
  return { target, class: r.class as RiskClassName, frozen: Boolean(r.frozen), classifiedAtBlock: Number(r.classified_at_block) };
}

/** Candidates that the registry classifies. A read that fails for one candidate drops only that candidate. */
export async function classifiedTargets(reads: ChainReads, registry: string, candidates: readonly string[]): Promise<TargetOption[]> {
  const found = await Promise.all(candidates.map((t) => classifiedTarget(reads, registry, t).catch(() => null)));
  return found.filter((t): t is TargetOption => t !== null);
}

/** The riskiest class among the targets, so the ceiling admits exactly what the owner picked. */
export function riskiest(targets: readonly TargetOption[]): RiskClassName {
  return targets.reduce<RiskClassName>((m, t) => (CLASS_ORDER.indexOf(t.class) > CLASS_ORDER.indexOf(m) ? t.class : m), "immutable_verified");
}

export interface CeilingOptions {
  maxPerTxYocto?: string;
  dailyTotalYocto?: string;
  agentAllowanceYocto?: string;
}

/** The raw ceiling the vault takes. NEAR only: R17 is NEAR-only. Defaults follow the demo4 ceiling the factory accepted. */
export function buildCeiling(targets: readonly TargetOption[], o: CeilingOptions = {}) {
  if (targets.length === 0) throw new Error("Pick at least one target the registry has classified.");
  return {
    tokens: [{ token: "near", max_per_tx: o.maxPerTxYocto ?? "500000000000000000000000", daily_total: o.dailyTotalYocto ?? "2000000000000000000000000" }],
    max_risk_class: riskiest(targets),
    allowed_targets: targets.map((t) => t.target),
    agent_allowance: o.agentAllowanceYocto ?? "1000000000000000000000000",
  };
}

export function createVaultArgs(o: { name: string; owner: string; operator: string | null; ceiling: ReturnType<typeof buildCeiling> }) {
  return { name: o.name, owner: o.owner, operator: o.operator, ceiling: o.ceiling };
}

export interface ChecklistItem {
  id: "created" | "ceiling" | "funded" | "agent";
  label: string;
  done: boolean;
}

/** Derived from chain state only, so a half-set-up vault resumes at the first item not done. */
export function setupChecklist(s: { exists: boolean; ceilingTargets: number; balanceYocto: bigint | null; agents: number }): ChecklistItem[] {
  return [
    { id: "created", label: "Vault created", done: s.exists },
    { id: "ceiling", label: "Ceiling set with at least one classified target", done: s.exists && s.ceilingTargets > 0 },
    { id: "funded", label: "Vault funded", done: s.balanceYocto !== null && s.balanceYocto >= FUNDED_YOCTO },
    { id: "agent", label: "First agent added", done: s.agents > 0 },
  ];
}

export const nextStep = (items: ChecklistItem[]) => items.find((i) => !i.done) ?? null;
