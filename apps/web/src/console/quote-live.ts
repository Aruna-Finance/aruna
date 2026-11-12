import type { VaultView } from "@aruna/sdk";
import { fetchViewTransport, Pool, quoteCoverage, Registry, type QuoteDeps, type QuoteResult } from "@aruna/sdk/coverage";
import { defaultLimit, PAYOUT_RATIO_BPS, POOL, REGISTRY, WINDOW_BLOCKS } from "./data/price";

// The price a policy implies, from the pool (plan U8, R27). Every number here is the pool's own `quote` view, reached
// through the SDK. This file holds no pricing arithmetic: a missing input is a refusal the screen shows, not a zero.

export function liveQuoteDeps(view: VaultView): QuoteDeps {
  const transport = fetchViewTransport({ network: "testnet" });
  return { registry: new Registry({ registry: REGISTRY, transport }), pool: new Pool({ pool: POOL, transport }), network: "testnet", readVault: async () => view };
}

export interface TargetPrice {
  target: string;
  /** The agent's policy as it is on chain now. */
  onChain: QuoteResult;
  /** The draft policy, not yet signed. */
  draft: QuoteResult;
}

/**
 * Prices each target twice: with the cap on chain, and with the draft cap and class ceiling as a proposed policy.
 * Both use the same sum insured, set above what the current cap can reach, so only the cap and class move the price.
 */
export async function priceTargets(
  deps: QuoteDeps,
  o: { vault: string; agentPublicKey: string; targets: string[]; currentCapYocto: bigint; draftCapYocto: bigint; draftMaxClass: "immutable_verified" | "local_upgradeable" | "global_by_account" | "unknown" },
): Promise<TargetPrice[]> {
  const base = {
    vault: o.vault,
    agentPublicKey: o.agentPublicKey,
    token: "near",
    limit: defaultLimit(o.currentCapYocto > o.draftCapYocto ? o.currentCapYocto : o.draftCapYocto),
    payoutRatioBps: PAYOUT_RATIO_BPS,
    windowBlocks: WINDOW_BLOCKS,
  };
  return Promise.all(
    o.targets.map(async (target) => ({
      target,
      onChain: await quoteCoverage(deps, { ...base, target }),
      draft: await quoteCoverage(deps, { ...base, target, proposed: { dailyCap: o.draftCapYocto.toString(), maxRiskClass: o.draftMaxClass } }),
    })),
  );
}
