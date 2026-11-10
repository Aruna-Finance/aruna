import { describe, expect, it } from "vitest";
import { channelOf, reportFor, type Observation } from "../src/watch.js";

const obs = (block: number, codeRef: Observation["codeRef"], resolvedHash: string | null): Observation => ({ target: "t.testnet", block, codeRef, resolvedHash });
const owner = { kind: "global_account" as const, ownerAccount: "owner.testnet" };

describe("drift channel inference (KTD4)", () => {
  it("a local code hash change is deploy_contract with both resolved hashes", () => {
    const r = reportFor(obs(10, { kind: "local", codeHash: "A" }, "A"), obs(20, { kind: "local", codeHash: "B" }, "B"), "att.testnet", 1, 600);
    expect(r?.channel).toBe("deploy_contract");
    expect([r?.before_resolved_hash, r?.after_resolved_hash]).toEqual(["A", "B"]);
  });

  it("an unchanged global_account ref whose resolved hash changed is deploy_global_contract", () => {
    expect(channelOf(obs(10, owner, "V1"), obs(20, owner, "V2"))).toBe("deploy_global_contract");
  });

  it("a move from local to global is use_global_contract", () => {
    expect(channelOf(obs(10, { kind: "local", codeHash: "A" }, "A"), obs(20, { kind: "global_hash", globalHash: "G" }, "G"))).toBe("use_global_contract");
  });

  it("no change yields no report", () => {
    expect(reportFor(obs(10, owner, "V1"), obs(20, owner, "V1"), "att.testnet", 1, 600)).toBeNull();
  });

  it("an observation without a resolved hash yields no report", () => {
    expect(reportFor(obs(10, owner, "V1"), obs(20, owner, null), "att.testnet", 1, 600)).toBeNull();
  });

  it("changed_at_block is the last unchanged observation plus one (KTD5)", () => {
    const r = reportFor(obs(277_000_100, owner, "V1"), obs(277_000_160, owner, "V2"), "att.testnet", 7, 600);
    expect(r?.changed_at_block).toBe(277_000_101);
    expect(r?.observed_at_block).toBe(277_000_160);
    expect(r?.expires_at).toBe(277_000_760);
    expect(r?.before_ref).toEqual({ kind: "global_account", owner_account: "owner.testnet" });
  });
});
