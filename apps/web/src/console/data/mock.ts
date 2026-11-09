import type { ClassEvidence, CodeRef, RiskClass } from "@/landing/lib/classifier-types";
import { ZERO_HASH } from "@aruna/classifier-core";
import type { TargetPreset, TargetRecord, TargetsReader } from "./types";

// SIMULATED. Targets, labels, test cases and their classes follow the prototype's mock data. Nothing here
// classifies anything: each class is the prototype's stated result. Hashes are placeholders.

const BLOCK = 241_800_000;

interface Spec {
  id: string;
  label: string;
  cls: RiskClass;
  basis: ClassEvidence["mutabilityBasis"];
  codeRef: CodeRef | null;
  fullKeys: number;
  fcKeys: number;
  resolved: string | null;
  imports?: string[];
  parsed?: boolean;
}

const global = (name: string): CodeRef => ({ kind: "global_hash", globalHash: `sim-hash-${name}` });

function record(s: Spec): TargetRecord {
  return {
    id: s.id,
    label: s.label,
    classifiedAtBlock: BLOCK,
    fetchedAtBlock: BLOCK,
    frozen: false,
    classification: {
      class: s.cls,
      evidence: {
        accountId: s.id,
        checkedAtBlock: BLOCK,
        codeRef: s.codeRef,
        fullAccessKeyCount: s.fullKeys,
        functionCallKeyCount: s.fcKeys,
        // view_account.code_hash: the local hash, or the zero hash for global contracts and no code
        // (docs/NEAR-FACTS.md §6).
        monitoredCodeHash: s.codeRef?.kind === "local" ? s.codeRef.codeHash : ZERO_HASH,
        resolvedCodeHash: s.resolved,
        upgradeImports: s.imports ?? [],
        mutabilityBasis: s.basis,
        wasmParsed: s.parsed ?? true,
      },
    },
  };
}

const SEED: Spec[] = [
  { id: "vault.testnet", label: "Vault", cls: "immutable_verified", basis: "no_detected_path", codeRef: global("vault-v1"), fullKeys: 0, fcKeys: 0, resolved: "sim-hash-vault-v1" },
  { id: "dex.testnet", label: "DEX", cls: "local_upgradeable", basis: "full_access_key", codeRef: { kind: "local", codeHash: "sim-hash-dex-v1" }, fullKeys: 1, fcKeys: 0, resolved: "sim-hash-dex-v1" },
  { id: "router.testnet", label: "Swap router", cls: "global_by_account", basis: "global_owner", codeRef: { kind: "global_account", ownerAccount: "owner.testnet" }, fullKeys: 1, fcKeys: 0, resolved: "sim-hash-router-v1" },
  { id: "router-2.testnet", label: "Swap router, second deployment", cls: "global_by_account", basis: "global_owner", codeRef: { kind: "global_account", ownerAccount: "owner.testnet" }, fullKeys: 0, fcKeys: 0, resolved: "sim-hash-router-v1" },
  { id: "lend.testnet", label: "Lending market", cls: "local_upgradeable", basis: "upgrade_imports", codeRef: global("lend-v1"), fullKeys: 0, fcKeys: 0, resolved: "sim-hash-lend-v1", imports: ["promise_batch_action_deploy_contract"] },
  { id: "vault-budi.aruna.testnet", label: "Your vault, classified by its own classifier", cls: "immutable_verified", basis: "no_detected_path", codeRef: global("vault-code-v1"), fullKeys: 0, fcKeys: 3, resolved: "sim-hash-vault-code-v1" },
  { id: "bridge.testnet", label: "Bridge", cls: "unknown", basis: "undetermined", codeRef: { kind: "local", codeHash: "sim-hash-bridge-v1" }, fullKeys: 0, fcKeys: 0, resolved: "sim-hash-bridge-v1", parsed: false },
];

interface Preset extends TargetPreset {
  spec: Spec;
}

const PRESETS: Preset[] = [
  { key: "hash-fckeys", id: "keyed-vault.testnet", title: "By hash, function-call keys only, clean imports", spec: { id: "keyed-vault.testnet", label: "By hash, function-call keys only, clean imports", cls: "immutable_verified", basis: "no_detected_path", codeRef: global("keyed"), fullKeys: 0, fcKeys: 2, resolved: "sim-hash-keyed" } },
  { key: "hash-delete", id: "selfdestruct.testnet", title: "By hash, no full-access key, delete-account import", spec: { id: "selfdestruct.testnet", label: "By hash, no full-access key, delete-account import", cls: "local_upgradeable", basis: "upgrade_imports", codeRef: global("sd"), fullKeys: 0, fcKeys: 0, resolved: "sim-hash-sd", imports: ["promise_batch_action_delete_account"] } },
  { key: "hash-full", id: "repoint.testnet", title: "By hash, with a full-access key", spec: { id: "repoint.testnet", label: "By hash, with a full-access key", cls: "local_upgradeable", basis: "full_access_key", codeRef: global("rp"), fullKeys: 1, fcKeys: 0, resolved: "sim-hash-rp" } },
  { key: "no-code", id: "plain.testnet", title: "An account with no contract", spec: { id: "plain.testnet", label: "An account with no contract", cls: "unknown", basis: "undetermined", codeRef: null, fullKeys: 1, fcKeys: 0, resolved: null, parsed: false } },
  { key: "hash-clean", id: "escrow.testnet", title: "By hash, no keys, clean imports", spec: { id: "escrow.testnet", label: "By hash, no keys, clean imports", cls: "immutable_verified", basis: "no_detected_path", codeRef: global("escrow"), fullKeys: 0, fcKeys: 0, resolved: "sim-hash-escrow" } },
  { key: "local-full", id: "amm.testnet", title: "Local code with a full key", spec: { id: "amm.testnet", label: "Local code with a full key", cls: "local_upgradeable", basis: "full_access_key", codeRef: { kind: "local", codeHash: "sim-hash-amm" }, fullKeys: 1, fcKeys: 0, resolved: "sim-hash-amm" } },
  { key: "hash-import", id: "governed.testnet", title: "By hash, no keys, deploy import", spec: { id: "governed.testnet", label: "By hash, no keys, deploy import", cls: "local_upgradeable", basis: "upgrade_imports", codeRef: global("gov"), fullKeys: 0, fcKeys: 0, resolved: "sim-hash-gov", imports: ["promise_batch_action_deploy_contract"] } },
  { key: "global-acct", id: "perps.testnet", title: "Global contract owned by another account", spec: { id: "perps.testnet", label: "Global contract owned by another account", cls: "global_by_account", basis: "global_owner", codeRef: { kind: "global_account", ownerAccount: "perps-owner.testnet" }, fullKeys: 1, fcKeys: 0, resolved: "sim-hash-perps" } },
  { key: "bad-wasm", id: "opaque.testnet", title: "Bytecode that cannot be parsed", spec: { id: "opaque.testnet", label: "Bytecode that cannot be parsed", cls: "unknown", basis: "undetermined", codeRef: { kind: "local", codeHash: "sim-hash-opaque" }, fullKeys: 0, fcKeys: 0, resolved: "sim-hash-opaque", parsed: false } },
];

const targets: TargetRecord[] = SEED.map(record);

export const mockTargets: TargetsReader = {
  currentBlock: async () => BLOCK,
  list: async () => [...targets],
  get: async (id) => targets.find((t) => t.id === id) ?? null,
  presets: async () => PRESETS.map(({ key, id, title }) => ({ key, id, title })),
  classify: async (key) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) throw new Error(`Unknown test case ${key}`);
    const existing = targets.find((t) => t.id === p.id);
    if (existing) return { record: existing, added: false };
    const r = record(p.spec);
    targets.push(r);
    return { record: r, added: true };
  },
};
