// The registry's class record, built in one place. The keeper and fixtures/tools.mjs both write a record
// with `set_class`; deriving its three computed fields twice would let them drift. Classification itself
// stays in @aruna/classifier-core (CLAUDE.md rule 10): this only shapes a Classification for the registry.
import type { Classification } from "@aruna/classifier-core";
import type { RegistryMethods, RegistryRiskClass } from "../generated/registry.js";

export type SetClassArgs = RegistryMethods["set_class"]["args"];

/** The four classes from least to most risky: the enum order of `contracts/common/src/class.rs`, pinned by a test. */
export const RISK_ORDER = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"] as const satisfies readonly RegistryRiskClass[];

/** True when `next` is the same as `prior` or less risky than it. */
export function isNoRiskier(next: RegistryRiskClass, prior: RegistryRiskClass): boolean {
  return RISK_ORDER.indexOf(next) <= RISK_ORDER.indexOf(prior);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The arguments of the registry's `set_class` for `target`. `evidence_hash` is the hex SHA-256 of the evidence's
 * JSON; `resolved_code_hash` is the code that actually runs; `upgrade_authority` is who can change it (the owner of
 * a global contract, else the target itself), which the pool's concentration limits group by.
 */
export async function classRecordArgs(target: string, c: Classification): Promise<SetClassArgs> {
  const { evidence } = c;
  return {
    target,
    class: c.class,
    evidence_hash: await sha256Hex(JSON.stringify(evidence)),
    resolved_code_hash: evidence.resolvedCodeHash,
    upgrade_authority: evidence.codeRef?.kind === "global_account" ? evidence.codeRef.ownerAccount : target,
  };
}
