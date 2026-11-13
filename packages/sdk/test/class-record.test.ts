import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Classification } from "@aruna/classifier-core";
import { describe, expect, it } from "vitest";
import { classRecordArgs, isNoRiskier, RISK_ORDER } from "../src/coverage/index.js";

const evidence = (over: Partial<Classification["evidence"]> = {}): Classification["evidence"] => ({
  accountId: "t.testnet",
  checkedAtBlock: 100,
  codeRef: null,
  fullAccessKeyCount: 0,
  functionCallKeyCount: 0,
  monitoredCodeHash: null,
  resolvedCodeHash: null,
  upgradeImports: [],
  mutabilityBasis: "undetermined",
  wasmParsed: false,
  ...over,
});

describe("classRecordArgs: the registry's set_class arguments", () => {
  it("hashes the evidence exactly as fixtures/tools.mjs class-args did: sha256 of its JSON, as hex", async () => {
    const ev = evidence({ codeRef: { kind: "local", codeHash: "H1" }, resolvedCodeHash: "H1", mutabilityBasis: "own_code", wasmParsed: true });
    const args = await classRecordArgs("t.testnet", { class: "local_upgradeable", evidence: ev });
    expect(args.evidence_hash).toBe(createHash("sha256").update(JSON.stringify(ev)).digest("hex"));
  });

  it("names the owner account of a global-by-account target as its upgrade authority", async () => {
    const ev = evidence({ codeRef: { kind: "global_account", ownerAccount: "owner.testnet" }, resolvedCodeHash: "G1", mutabilityBasis: "global_owner", wasmParsed: true });
    const args = await classRecordArgs("t.testnet", { class: "global_by_account", evidence: ev });
    expect(args).toMatchObject({ target: "t.testnet", class: "global_by_account", resolved_code_hash: "G1", upgrade_authority: "owner.testnet" });
  });

  it("names the target itself as the upgrade authority of a local or global-hash contract", async () => {
    const local = await classRecordArgs("t.testnet", { class: "local_upgradeable", evidence: evidence({ codeRef: { kind: "local", codeHash: "H1" }, resolvedCodeHash: "H1" }) });
    const pinned = await classRecordArgs("t.testnet", { class: "immutable_verified", evidence: evidence({ codeRef: { kind: "global_hash", globalHash: "G2" }, resolvedCodeHash: "G2" }) });
    expect(local.upgrade_authority).toBe("t.testnet");
    expect(pinned.upgrade_authority).toBe("t.testnet");
  });

  it("gives a null resolved code hash for an account with no code", async () => {
    const args = await classRecordArgs("t.testnet", { class: "unknown", evidence: evidence() });
    expect(args.resolved_code_hash).toBeNull();
  });
});

describe("risk order", () => {
  it("is the enum order of contracts/common/src/class.rs, least risky first", () => {
    const rust = readFileSync(join(import.meta.dirname, "../../../contracts/common/src/class.rs"), "utf8");
    const body = /pub enum RiskClass \{([^}]*)\}/.exec(rust)?.[1] ?? "";
    const variants = [...body.matchAll(/^\s*([A-Z][A-Za-z]+),/gm)].map((m) => m[1]!.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase());
    expect(variants.length).toBe(4);
    expect([...RISK_ORDER]).toEqual(variants);
  });

  it("calls a class no riskier than the one before it when it is the same or safer", () => {
    expect(isNoRiskier("global_by_account", "global_by_account")).toBe(true);
    expect(isNoRiskier("immutable_verified", "global_by_account")).toBe(true);
  });

  it("calls a riskier class riskier", () => {
    expect(isNoRiskier("local_upgradeable", "immutable_verified")).toBe(false);
    expect(isNoRiskier("unknown", "global_by_account")).toBe(false);
  });

  it("treats unknown as the riskiest: anything is no riskier than it", () => {
    for (const c of RISK_ORDER) expect(isNoRiskier(c, "unknown")).toBe(true);
  });
});
