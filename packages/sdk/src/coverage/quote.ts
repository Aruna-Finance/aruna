// The price a policy implies (docs/SDK.md). Three sources meet here: the target's recorded class (the
// registry), the agent's daily cap for the token (the vault's policy) and the pool's own `quote`
// view. The SDK adds no pricing arithmetic; it never invents a limit, ratio or window, and a missing
// input is a refusal with a reason, never a zero premium (a free policy was a critical bug found in
// review, docs/AUDIT-v0.md C2).
import type { RiskClass } from "@aruna/classifier-core";
import type { Network } from "@aruna/rpc";
import { readVault, type VaultView } from "../vault-view.js";
import type { Pool, Quote } from "./pool.js";
import type { Registry } from "./registry.js";

export interface QuoteRequest {
  /** The covered target. */
  target: string;
  /** The vault and agent whose exposure is covered. */
  vault: string;
  agentPublicKey: string;
  /** "near", or a NEP-141 contract. Each token is its own book, with no conversion between them. */
  token: string;
  /** The sum insured, in the token's smallest unit. */
  limit: string;
  payoutRatioBps: number;
  windowBlocks: number;
  /** A draft policy to price before it is signed. Omitted fields keep the agent's on-chain values. */
  proposed?: ProposedPolicy;
}

/**
 * A policy edit not yet sent. The proposed cap goes to the pool's own `quote` in place of the on-chain
 * cap, so the premium moves while the owner edits; the pool still does all the pricing.
 */
export interface ProposedPolicy {
  /** The agent's daily cap for the request's token, in its smallest unit. */
  dailyCap?: string;
  /** The riskiest class the policy would admit. A target whose recorded class is riskier gets no quote. */
  maxRiskClass?: RiskClass;
}

/** The vault's order of risk classes: `spend` admits a target when its class is at or below `max_risk_class`
 * (contracts/common/src/class.rs, contracts/vault/src/spend.rs). `unknown` is the riskiest. */
export const RISK_CLASS_ORDER: readonly RiskClass[] = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"];

/** Whether a policy whose riskiest class is `max` admits a target recorded as `cls`, by the vault's rule. */
export function admitsClass(max: RiskClass, cls: string): boolean {
  const i = RISK_CLASS_ORDER.indexOf(cls as RiskClass);
  return i !== -1 && i <= RISK_CLASS_ORDER.indexOf(max);
}

/** Why no quote exists. These are SDK-side reasons, separate from the contracts' ARUNA_ reasons. */
export type QuoteRefusal = "no_class_record" | "not_coverable" | "agent_not_found" | "no_daily_cap" | "class_not_insurable" | "class_not_admitted";

export type QuoteResult =
  | {
      ok: true;
      quote: Quote;
      /** Where each input came from, so the price is checkable by hand. */
      inputs: {
        class: string;
        classSource: string;
        dailyCap: string;
        dailyCapSource: string;
        limit: string;
        payoutRatioBps: number;
        windowBlocks: number;
        /** True when any input came from `proposed`: the price of a draft, not of the policy on chain. */
        proposed: boolean;
        /** The riskiest class the priced policy admits, when one was proposed. */
        maxRiskClass?: RiskClass;
      };
    }
  | { ok: false; reason: QuoteRefusal; detail: string };

export interface QuoteDeps {
  registry: Registry;
  pool: Pool;
  network?: Network;
  /** Replace the vault read (tests, a cache). */
  readVault?: (vault: string) => Promise<VaultView>;
}

const refuse = (reason: QuoteRefusal, detail: string): QuoteResult => ({ ok: false, reason, detail });

export async function quoteCoverage(deps: QuoteDeps, r: QuoteRequest): Promise<QuoteResult> {
  const record = await deps.registry.classOf(r.target);
  if (!record) return refuse("no_class_record", `${r.target} has no class on record in ${deps.registry.registryId}`);
  if (!record.resolved_code_hash) return refuse("not_coverable", `${r.target}'s record carries no resolved code hash, so it cannot be covered`);

  const p = r.proposed ?? {};
  if (p.dailyCap !== undefined && !/^\d+$/.test(p.dailyCap)) throw new TypeError(`proposed dailyCap must be an integer in the token's smallest unit, got ${JSON.stringify(p.dailyCap)}`);
  if (p.maxRiskClass !== undefined && !RISK_CLASS_ORDER.includes(p.maxRiskClass)) throw new TypeError(`proposed maxRiskClass is not a class: ${JSON.stringify(p.maxRiskClass)}`);
  if (p.maxRiskClass !== undefined && !admitsClass(p.maxRiskClass, record.class)) {
    return refuse("class_not_admitted", `${r.target} is recorded as ${record.class}, riskier than the proposed ${p.maxRiskClass}; the vault would refuse every spend to it`);
  }

  const view = await (deps.readVault ?? ((v) => readVault(v, { network: deps.network })))(r.vault);
  const agent = view.agents.find((a) => a.publicKey === r.agentPublicKey);
  if (!agent) return refuse("agent_not_found", `${r.agentPublicKey} is not an agent of ${r.vault}`);
  const limits = agent.policy.limits ?? [{ token: "near", maxPerTx: agent.policy.maxPerTx, dailyCap: agent.policy.dailyCap }];
  const cap = p.dailyCap ?? limits.find((l) => l.token === r.token)?.dailyCap;
  if (cap === undefined || BigInt(cap) === 0n) {
    const whose = p.dailyCap !== undefined ? "the proposed policy has" : "the agent has";
    return refuse("no_daily_cap", `${whose} no daily cap for ${r.token}; without one the exposure is unbounded and cannot be priced`);
  }

  const quote = await deps.pool.quote({ class: record.class, limit: r.limit, payoutRatioBps: r.payoutRatioBps, windowBlocks: r.windowBlocks, dailyCap: cap });
  if (!quote) return refuse("class_not_insurable", `class ${record.class} is not insurable`);
  return {
    ok: true,
    quote,
    inputs: {
      class: record.class,
      classSource: `${deps.registry.registryId} get_class(${r.target})`,
      dailyCap: cap,
      dailyCapSource:
        p.dailyCap !== undefined ? `proposed, not yet signed (agent ${r.agentPublicKey}, token ${r.token})` : `${r.vault} policy of agent ${r.agentPublicKey}, token ${r.token}`,
      limit: r.limit,
      payoutRatioBps: r.payoutRatioBps,
      windowBlocks: r.windowBlocks,
      proposed: p.dailyCap !== undefined || p.maxRiskClass !== undefined,
      ...(p.maxRiskClass !== undefined ? { maxRiskClass: p.maxRiskClass } : {}),
    },
  };
}
