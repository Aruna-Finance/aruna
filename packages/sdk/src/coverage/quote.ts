// The price a policy implies (docs/SDK.md). Three sources meet here: the target's recorded class (the
// registry), the agent's daily cap for the token (the vault's policy) and the pool's own `quote`
// view. The SDK adds no pricing arithmetic; it never invents a limit, ratio or window, and a missing
// input is a refusal with a reason, never a zero premium (a free policy was a critical bug found in
// review, docs/AUDIT-v0.md C2).
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
}

/** Why no quote exists. These are SDK-side reasons, separate from the contracts' ARUNA_ reasons. */
export type QuoteRefusal = "no_class_record" | "not_coverable" | "agent_not_found" | "no_daily_cap" | "class_not_insurable";

export type QuoteResult =
  | {
      ok: true;
      quote: Quote;
      /** Where each input came from, so the price is checkable by hand. */
      inputs: { class: string; classSource: string; dailyCap: string; dailyCapSource: string; limit: string; payoutRatioBps: number; windowBlocks: number };
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

  const view = await (deps.readVault ?? ((v) => readVault(v, { network: deps.network })))(r.vault);
  const agent = view.agents.find((a) => a.publicKey === r.agentPublicKey);
  if (!agent) return refuse("agent_not_found", `${r.agentPublicKey} is not an agent of ${r.vault}`);
  const limits = agent.policy.limits ?? [{ token: "near", maxPerTx: agent.policy.maxPerTx, dailyCap: agent.policy.dailyCap }];
  const cap = limits.find((l) => l.token === r.token)?.dailyCap;
  if (cap === undefined || BigInt(cap) === 0n) return refuse("no_daily_cap", `the agent has no daily cap for ${r.token}; without one the exposure is unbounded and cannot be priced`);

  const quote = await deps.pool.quote({ class: record.class, limit: r.limit, payoutRatioBps: r.payoutRatioBps, windowBlocks: r.windowBlocks, dailyCap: cap });
  if (!quote) return refuse("class_not_insurable", `class ${record.class} is not insurable`);
  return {
    ok: true,
    quote,
    inputs: {
      class: record.class,
      classSource: `${deps.registry.registryId} get_class(${r.target})`,
      dailyCap: cap,
      dailyCapSource: `${r.vault} policy of agent ${r.agentPublicKey}, token ${r.token}`,
      limit: r.limit,
      payoutRatioBps: r.payoutRatioBps,
      windowBlocks: r.windowBlocks,
    },
  };
}
