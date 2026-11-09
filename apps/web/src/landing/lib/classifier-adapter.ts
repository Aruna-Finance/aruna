// STUB ADAPTER. Not a classifier. It returns canned results for four example accounts so the UI
// can be built before @aruna/classifier-core exists. It implements NO classification check
// (CLAUDE.md rule 10). Replace the body of `lookup` with:
//   classify(accountId, createFetchRpcReader(network))   // from @aruna/classifier-core + @aruna/rpc
import type { LookupResult, Network, Classification } from "./classifier-types";

export const ZERO_HASH = "1111…1111"; // display form, NEAR-FACTS §6

function stub(
  accountId: string,
  cls: Classification["class"],
  e: Partial<Classification["evidence"]>,
): Classification {
  return {
    class: cls,
    evidence: {
      accountId,
      checkedAtBlock: 0,
      codeRef: null,
      fullAccessKeyCount: 0,
      functionCallKeyCount: 0,
      resolvedCodeHash: null,
      upgradeImports: [],
      mutabilityBasis: "undetermined",
      wasmParsed: false,
      ...e,
    },
  };
}

const EXAMPLES: Record<string, Classification> = {
  "immutable.example.testnet": stub("immutable.example.testnet", "immutable_verified", {
    codeRef: { kind: "global_hash", globalHash: "STUB-hash-a" },
    functionCallKeyCount: 2,
    resolvedCodeHash: "STUB-hash-a",
    mutabilityBasis: "no_detected_path",
    wasmParsed: true,
  }),
  "upgradeable.example.testnet": stub("upgradeable.example.testnet", "local_upgradeable", {
    codeRef: { kind: "local", codeHash: "STUB-hash-b" },
    fullAccessKeyCount: 1,
    resolvedCodeHash: "STUB-hash-b",
    mutabilityBasis: "full_access_key",
    wasmParsed: true,
  }),
  "router.example.testnet": stub("router.example.testnet", "global_by_account", {
    codeRef: { kind: "global_account", ownerAccount: "owner.example.testnet" },
    resolvedCodeHash: "STUB-hash-c",
    mutabilityBasis: "global_owner",
    wasmParsed: true,
  }),
  "nocode.example.testnet": stub("nocode.example.testnet", "unknown", {}),
};

export const EXAMPLE_ACCOUNTS = Object.keys(EXAMPLES);

export async function lookup(accountId: string, _network: Network): Promise<LookupResult> {
  const hit = EXAMPLES[accountId.trim()];
  if (hit) return { ok: true, classification: hit, source: "stub" };
  return {
    ok: false,
    reason:
      "Live lookup is not wired yet: @aruna/classifier-core has not landed. Try an example account.",
  };
}
