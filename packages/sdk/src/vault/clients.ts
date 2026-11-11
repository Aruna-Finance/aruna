// Vault clients, one per role (docs/SDK.md "Vault"). An agent key physically cannot reach owner
// methods, so they are not on the agent's client. There is no method taking a free-form
// (target, method, args): the vault is never a generic executor (CLAUDE.md rule 5).
import { parseReason, type Reason } from "../reasons.js";
import type { VaultMethods } from "../generated/vault.js";
import { readVault, type VaultView } from "../vault-view.js";
import { ArunaAuthError, VaultVersionError, type VaultTransport } from "./transport.js";
import { CAPABILITIES, KNOWN_VAULT_VERSIONS, type VaultVersion } from "./versions.js";
import type { Network } from "@aruna/rpc";

const TGAS_AGENT = 60n;
const TGAS_FT = 150n;
const TGAS_ADMIN = 30n;

/** "near", or a NEP-141 token contract. */
export type Token = string;

/** A named action. `swap` spends NEAR; `ft_swap` spends the given token. */
export interface SpendAction {
  adapter: "swap" | "ft_swap";
  target: string;
  /** In the token's smallest unit. */
  amount: string;
  minAmountOut: string;
  /** The token contract, for `ft_swap` only. */
  token?: string;
}

export type SpendResult =
  /** Sent and settled; `settled` is false when the target failed and the reservation was released. */
  | { ok: true; settled: boolean; tx: string }
  /** Refused by policy. Nothing was sent. Do not retry it: a refusal means the agent must not. */
  | { ok: false; reason: Reason; targetClass: string | null; tx: string };

export interface Simulation {
  verdict: "allow" | "block";
  reason: Reason | null;
  targetClass: string | null;
}

export interface Policy {
  limits: { token: Token; maxPerTx: string; dailyCap: string }[];
  maxSlippageBps: number;
  allowedTargets: string[];
  maxRiskClass: "immutable_verified" | "local_upgradeable" | "global_by_account" | "unknown";
}

const rawToken = (t: Token) => (t === "near" ? "near" : { ft: t });
const rawPolicy = (p: Policy) => ({
  limits: p.limits.map((l) => ({ token: rawToken(l.token), max_per_tx: l.maxPerTx, daily_cap: l.dailyCap })),
  max_slippage_bps: p.maxSlippageBps,
  allowed_targets: p.allowedTargets,
  max_risk_class: p.maxRiskClass,
});

interface Options {
  vaultId: string;
  transport: VaultTransport;
  network?: Network;
}

/** A method the vault contract really has: the generated ABI types make a renamed or removed one a compile error. */
type VaultMethod = keyof VaultMethods & string;

class VaultBase {
  readonly vaultId: string;
  protected readonly t: VaultTransport;
  protected readonly network: Network;
  private version: VaultVersion | undefined;

  constructor(o: Options) {
    this.vaultId = o.vaultId;
    this.t = o.transport;
    this.network = o.network ?? "testnet";
  }

  /** The vault's version, from its global contract hash. Refuses an unknown hash, loudly. */
  async vaultVersion(): Promise<VaultVersion> {
    if (this.version) return this.version;
    const { globalContractHash } = await this.t.account(this.vaultId);
    const v = globalContractHash ? KNOWN_VAULT_VERSIONS[globalContractHash] : undefined;
    if (!v) throw new VaultVersionError(`${this.vaultId} runs ${globalContractHash ?? "no global contract by hash"}, which this SDK does not support. Known vault versions: ${Object.entries(KNOWN_VAULT_VERSIONS).map(([h, n]) => `${n} ${h}`).join(", ")}`);
    this.version = v;
    return v;
  }

  protected async needs(cap: "spend" | "tokens" | "simulate", what: string) {
    const v = await this.vaultVersion();
    if (!CAPABILITIES[v][cap]) throw new VaultVersionError(`${what} needs a vault version with ${cap}; ${this.vaultId} runs ${v}`);
    return v;
  }

  protected call(method: VaultMethod, args: Record<string, unknown>, depositYocto = 0n, tgas = TGAS_ADMIN) {
    return this.t.call(this.vaultId, method, args, { depositYocto, tgas });
  }

  /** The vault's public state, as the public agent page shows it. No key needed. */
  read(): Promise<VaultView> {
    return readVault(this.vaultId, { network: this.network });
  }
}

/** For an agent: the transport signs as the vault account with the agent's function-call key. */
export class AgentVault extends VaultBase {
  constructor(o: Options & { autoRefresh?: boolean }) {
    super(o);
    this.autoRefresh = o.autoRefresh ?? true;
  }
  private readonly autoRefresh: boolean;

  private actionArgs(a: SpendAction) {
    if ((a.adapter === "ft_swap") !== Boolean(a.token)) throw new Error("ft_swap needs a token; swap must not have one");
    return { adapter: a.adapter, target: a.target, amount: a.amount, min_amount_out: a.minAmountOut, ...(a.token ? { token: a.token } : {}) };
  }

  /**
   * Spends through a named adapter. A refusal resolves with `{ ok: false, reason }`; an authorization
   * failure throws ArunaAuthError. A stale class is refreshed and the spend retried ONCE (docs/SDK.md),
   * unless `autoRefresh: false`. No other refusal is ever retried.
   */
  async spend(a: SpendAction): Promise<SpendResult> {
    const v = await this.needs("spend", "spend");
    if (a.adapter === "ft_swap" && !CAPABILITIES[v].tokens) throw new VaultVersionError(`ft_swap needs vault v3 or later; ${this.vaultId} runs ${v}`);
    const args = v === "v2" ? (({ token: _t, ...rest }) => rest)(this.actionArgs(a)) : this.actionArgs(a);
    const once = async (): Promise<SpendResult> => {
      const r = await this.call("spend", args, 0n, a.adapter === "ft_swap" ? TGAS_FT : TGAS_AGENT);
      const out = r.value as { outcome?: string; reason?: string; class?: string | null } | boolean | null;
      if (typeof out === "boolean") return { ok: true, settled: out, tx: r.tx };
      if (out && out.outcome === "Blocked" && out.reason) return { ok: false, reason: parseReason(out.reason), targetClass: out.class ?? null, tx: r.tx };
      throw new ArunaAuthError(`unexpected spend result: ${JSON.stringify(out)}`);
    };
    const first = await once();
    if (first.ok || first.reason !== "CLASS_STALE" || !this.autoRefresh) return first;
    await this.refreshClass(a.target);
    return once();
  }

  /** Free and NOT binding: the checks `spend` runs, without sending anything. Vault v4 and later. */
  async simulate(a: SpendAction): Promise<Simulation> {
    await this.needs("simulate", "simulate");
    const pk = await this.publicKey();
    const s = await this.t.view<{ verdict: "allow" | "block"; reason: string | null; class: string | null }>(this.vaultId, "simulate" satisfies VaultMethod, { public_key: pk, ...this.actionArgs(a) });
    return { verdict: s.verdict, reason: s.reason ? parseReason(s.reason) : null, targetClass: s.class };
  }

  /** Pulls the target's class from the registry into the vault's cache. */
  async refreshClass(target: string) {
    await this.call("refresh_class", { target }, 0n, TGAS_AGENT);
  }

  /** This agent's limits, usage and what is left today, per token, and the vault's NEAR balance. */
  async budget(): Promise<{ balanceNear: string; tokens: { token: Token; maxPerTx: string; dailyCap: string; spentToday: string; reserved: string; remaining: string }[] }> {
    const pk = await this.publicKey();
    const [view, acct] = await Promise.all([this.read(), this.t.account(this.vaultId)]);
    const me = view.agents.find((x) => x.publicKey === pk);
    if (!me) throw new ArunaAuthError(`${pk} is not an agent of ${this.vaultId}`);
    const limits = me.policy.limits ?? [{ token: "near", maxPerTx: me.policy.maxPerTx, dailyCap: me.policy.dailyCap }];
    const usage = me.usageByToken ?? [];
    return {
      balanceNear: acct.amount,
      tokens: limits.map((l) => {
        const u = usage.find((x) => x.token === l.token) ?? { spentToday: "0", reserved: "0" };
        const left = BigInt(l.dailyCap) - BigInt(u.spentToday) - BigInt(u.reserved);
        return { ...l, spentToday: u.spentToday, reserved: u.reserved, remaining: (left > 0n ? left : 0n).toString() };
      }),
    };
  }

  /** Recorded exposure per target and token, each with the class it was recorded at. */
  async exposure() {
    const v = await this.read();
    return v.exposureByToken ?? v.exposure ?? [];
  }

  private pk: string | undefined;
  /** The agent key's public key, taken from the transport's signer. */
  async publicKey(): Promise<string> {
    if (this.pk) return this.pk;
    const t = this.t as VaultTransport & { publicKey?: () => Promise<string> };
    if (!t.publicKey) throw new Error("this transport does not expose the agent's public key");
    this.pk = await t.publicKey();
    return this.pk;
  }
}

/** For the operator (the AaaS company). Tightening only; the vault enforces it. Each power-granting
 * call attaches 1 yoctoNEAR, so it needs the operator's full-access key (docs/DECISIONS.md D-52). */
export class OperatorVault extends VaultBase {
  /** Takes a public key the caller generated; the SDK never creates keys. */
  createAgent(o: { publicKey: string; label: string; policy: Policy }) {
    return this.call("add_agent", { public_key: o.publicKey, label: o.label, policy: rawPolicy(o.policy) }, 1n);
  }
  tightenPolicy(publicKey: string, policy: Policy) {
    return this.call("update_policy", { public_key: publicKey, policy: rawPolicy(policy) }, 1n);
  }
  pauseAgent(publicKey: string) {
    return this.call("pause_agent", { public_key: publicKey });
  }
  /** Deletes the key: from then on the network itself rejects the agent. */
  revokeAgent(publicKey: string) {
    return this.call("revoke_agent", { public_key: publicKey });
  }
}

/** For the owner (the client). Everything the operator can do, plus loosening, resuming and funds. */
export class OwnerVault extends OperatorVault {
  updatePolicy(publicKey: string, policy: Policy) {
    return this.call("update_policy", { public_key: publicKey, policy: rawPolicy(policy) }, 1n);
  }
  resumeAgent(publicKey: string) {
    return this.call("resume_agent", { public_key: publicKey }, 1n);
  }
  setOperator(accountId: string | null) {
    return this.call("set_operator", { operator: accountId }, 1n);
  }
  setCeiling(ceiling: Record<string, unknown>) {
    return this.call("set_ceiling", { ceiling }, 1n);
  }
  /** Pays only the registered owner. `token` omitted means NEAR. */
  withdrawToOwner(amount: string, token?: Token) {
    return this.call("withdraw_to_owner", { amount, ...(token && token !== "near" ? { token: rawToken(token) } : {}) }, 1n);
  }
}

export { ArunaAuthError };
