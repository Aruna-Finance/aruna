// The keyless Classifier (docs/SDK.md): no account, no key, no registration.
import { classify } from "@aruna/classifier-core";
import type { ClassEvidence, MutabilityBasis, RiskClass, RpcReader } from "@aruna/classifier-core";
import { createFetchReader, type Network } from "@aruna/rpc";

import type { DriftReport, Registry } from "./coverage/registry.js";

export interface CheckResult {
  class: RiskClass;
  evidence: ClassEvidence;
  /** One line a person or a model can act on. Derived from class and basis only. */
  reason: string;
}

/** What `watch` found, and what the registry has on record beside it. */
export interface WatchResult {
  target: string;
  class: RiskClass;
  /** The two hashes the monitoring question turns on: the field most tools watch, and the code that runs. */
  channels: {
    monitoredCodeHash: string | null;
    resolvedCodeHash: string | null;
    /** Who can change the code: the global contract's owner for `global_by_account`, else the target itself. */
    upgradeAuthority: string;
    /** True when the monitored field cannot show a change: the code runs by account, not by hash. */
    changeInvisibleToCodeHash: boolean;
  };
  /** "not consulted": no registry was supplied. "not recorded": the registry has no class for the target. */
  recorded: { state: "not consulted" } | { state: "not recorded" } | { state: "recorded"; class: RiskClass; resolvedCodeHash: string | null; frozen: boolean };
  /** True when the live resolved hash differs from the recorded one; null when there is nothing to compare. */
  changedSinceRecorded: boolean | null;
  /** The registry's newest drift report for the target, if a registry was supplied and it holds one. */
  latestReport: DriftReport | null;
}

export interface ClassifierOptions {
  network?: Network;
  /** Supply your own reader (custom endpoints, a cache, a test double). */
  reader?: RpcReader;
}

const REASONS: Record<MutabilityBasis, (e: ClassEvidence) => string> = {
  no_detected_path: () =>
    "No detected upgrade path under Aruna's checks: code pinned by hash, no full-access key, none of the scanned host functions imported.",
  full_access_key: (e) =>
    `${e.fullAccessKeyCount} full-access key${e.fullAccessKeyCount === 1 ? "" : "s"} on the account: the holder can replace the code at any time.`,
  upgrade_imports: (e) =>
    `No full-access key, but the code imports ${e.upgradeImports.join(", ")}. An upgrade path cannot be ruled out; it may have no reachable route.`,
  own_code: () =>
    "Local code with no full-access key and clean imports, but not pinned by hash, so it is not counted as verified.",
  global_owner: (e) =>
    `Runs a global contract published by ${e.codeRef?.kind === "global_account" ? e.codeRef.ownerAccount : "another account"}, which can redeploy it without any transaction touching this account. view_account.code_hash will not change when it does.`,
  undetermined: (e) =>
    e.codeRef === null
      ? "No contract code on this account (or the account does not exist). Nothing to classify; treat as unknown."
      : "The code could not be fetched or parsed. Not determined; treat as unknown.",
};

export const CLASS_EXPLANATIONS: Record<RiskClass, string> = {
  immutable_verified:
    "Code referenced by hash, no full-access key, and none of the deploy, re-point, full-access-key or delete-account host functions imported. No detected upgrade path under these checks. It is not a claim that the contract is safe.",
  local_upgradeable:
    "An upgrade path exists or cannot be ruled out: a full-access key, a scanned host function in the imports, or local code not pinned by hash. Check the basis: upgrade_imports means the capability is linked, not that a route is reachable.",
  global_by_account:
    "The account executes a global contract published by another account. That owner can redeploy it at any time, no transaction touches this account, and view_account.code_hash stays the zero hash. Only view_code or the owner's DeployGlobalContract reveal the change.",
  unknown:
    "Could not be determined: no code, or code that cannot be fetched or parsed. Never insurable, and never to be read as safe.",
};

export class Classifier {
  private readonly reader: RpcReader;

  constructor(options: ClassifierOptions = {}) {
    this.reader = options.reader ?? createFetchReader({ network: options.network ?? "mainnet" });
  }

  /** Class, evidence and a one-line reason. Rejects on RPC failure; a failed read is not a class. */
  async check(accountId: string): Promise<CheckResult> {
    const c = await classify(accountId, this.reader);
    return { class: c.class, evidence: c.evidence, reason: REASONS[c.evidence.mutabilityBasis](c.evidence) };
  }

  /**
   * The live answer to "has it changed", with the registry's record beside it. It reuses `check`, so
   * there is one classification engine; it adds only the comparison with what the registry recorded.
   * Without a registry it returns the live view alone and says the registry was not consulted.
   */
  async watch(target: string, o: { registry?: Registry } = {}): Promise<WatchResult> {
    const { class: cls, evidence } = await this.check(target);
    const byAccount = evidence.codeRef?.kind === "global_account";
    const channels: WatchResult["channels"] = {
      monitoredCodeHash: evidence.monitoredCodeHash,
      resolvedCodeHash: evidence.resolvedCodeHash,
      upgradeAuthority: evidence.codeRef?.kind === "global_account" ? evidence.codeRef.ownerAccount : target,
      changeInvisibleToCodeHash: byAccount,
    };
    if (!o.registry) return { target, class: cls, channels, recorded: { state: "not consulted" }, changedSinceRecorded: null, latestReport: null };
    const [record, latestReport] = await Promise.all([o.registry.classOf(target), o.registry.latestReport(target)]);
    if (!record) return { target, class: cls, channels, recorded: { state: "not recorded" }, changedSinceRecorded: null, latestReport };
    const changed = record.resolved_code_hash && evidence.resolvedCodeHash ? record.resolved_code_hash !== evidence.resolvedCodeHash : null;
    return { target, class: cls, channels, recorded: { state: "recorded", class: record.class, resolvedCodeHash: record.resolved_code_hash ?? null, frozen: record.frozen }, changedSinceRecorded: changed, latestReport };
  }

  /** What a class means and what can still change. */
  static explain(cls: RiskClass): string {
    return CLASS_EXPLANATIONS[cls];
  }
}
