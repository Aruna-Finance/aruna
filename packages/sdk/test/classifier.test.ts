import { describe, expect, it } from "vitest";
import type { RpcReader, ViewAccount } from "@aruna/classifier-core";
import { Classifier } from "../src/index.js";

const ZERO = "11111111111111111111111111111111";
// magic + version + type section + one func import "env"."promise_batch_action_deploy_contract"
const DEPLOY_IMPORT_MODULE = (() => {
  const name = [..."promise_batch_action_deploy_contract"].map((c) => c.charCodeAt(0));
  const body = [1, 3, 0x65, 0x6e, 0x76, name.length, ...name, 0x00, 0];
  return [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0, 2, body.length, ...body];
})();
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

const reader = (account: ViewAccount, code: number[] = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0], full = 0): RpcReader => ({
  viewAccount: async () => account,
  viewAccessKeyList: async () => ({ keys: Array.from({ length: full }, (_, i) => ({ publicKey: `k${i}`, permission: "full_access" as const })) }),
  viewCode: async () => ({ codeBase64: b64(code), hash: "R" }),
});

describe("Classifier.check", () => {
  it("returns the core's class and evidence unchanged, plus a reason", async () => {
    const acct: ViewAccount = { exists: true, blockHeight: 1, codeHash: ZERO, globalContractHash: null, globalContractAccountId: "owner.near" };
    const r = await new Classifier({ reader: reader(acct) }).check("u.near");
    expect(r.class).toBe("global_by_account");
    expect(r.evidence.codeRef).toEqual({ kind: "global_account", ownerAccount: "owner.near" });
    expect(r.reason).toMatch(/owner\.near/);
    expect(r.reason).toMatch(/code_hash will not change/);
  });

  it("an upgrade_imports reason never says the contract can be upgraded", async () => {
    const acct: ViewAccount = { exists: true, blockHeight: 1, codeHash: "L", globalContractHash: null, globalContractAccountId: null };
    const r = await new Classifier({ reader: reader(acct, DEPLOY_IMPORT_MODULE) }).check("x.near");
    expect(r.evidence.mutabilityBasis).toBe("upgrade_imports");
    expect(r.reason).toMatch(/promise_batch_action_deploy_contract/);
    expect(r.reason.toLowerCase()).not.toMatch(/can be upgraded/);
  });

  it("every class has an explanation, and unknown is never described as safe", () => {
    for (const c of ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"] as const) {
      expect(Classifier.explain(c).length).toBeGreaterThan(40);
    }
    expect(Classifier.explain("unknown")).toMatch(/never to be read as safe/);
  });
});
