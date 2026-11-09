// The test list in docs/TESTING.md "Classifier", one case per line there, plus the transport rule (KTD3).
import { describe, expect, it } from "vitest";
import { classify, ZERO_HASH } from "../src/index.js";
import type { AccessKeyPermissionKind, RpcReader, ViewAccount, ViewCode } from "../src/index.js";
import { funcs, moduleWith, toBase64 } from "./helpers/wasm-builder.js";

const ID = "target.testnet";
const LOCAL_HASH = "8Q4NTwRufQxXHvHhfnJaVfNJ3Yp4rxz6Y2xX1d2uvJQ8";
const GLOBAL_HASH = "73ETFhQ7Yq3qG8m5rzN6a9bT9xLwV1e4hW2pS7uK3cDn";
const RESOLVED_HASH = "J2gKRs4vXzWd8gH3nM1pQ6tY9bC2fL5kE7aS3uV8xZq1";
const CLEAN = funcs("input", "storage_write", "promise_batch_create", "promise_batch_action_function_call", "value_return");

type Fake = {
  account: ViewAccount;
  keys?: AccessKeyPermissionKind[];
  code?: Uint8Array | "unavailable" | "garbage";
  codeHash?: string;
  fail?: "viewAccount" | "viewAccessKeyList" | "viewCode";
};

function reader(f: Fake): RpcReader & { calls: string[] } {
  const calls: string[] = [];
  const maybeFail = (m: string) => {
    calls.push(m);
    if (f.fail === m) return Promise.reject(new Error(`transport: ${m} timed out`));
    return null;
  };
  return {
    calls,
    viewAccount: (id) => maybeFail("viewAccount") ?? Promise.resolve(f.account),
    viewAccessKeyList: () =>
      maybeFail("viewAccessKeyList") ??
      Promise.resolve({ keys: (f.keys ?? []).map((permission, i) => ({ publicKey: `ed25519:k${i}`, permission })) }),
    viewCode: () => {
      const failed = maybeFail("viewCode");
      if (failed) return failed;
      let v: ViewCode;
      if (f.code === undefined || f.code === "unavailable") v = null;
      else if (f.code === "garbage") v = { codeBase64: toBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), hash: f.codeHash ?? RESOLVED_HASH };
      else v = { codeBase64: toBase64(f.code), hash: f.codeHash ?? RESOLVED_HASH };
      return Promise.resolve(v);
    },
  };
}

const byHash: ViewAccount = { exists: true, blockHeight: 100, codeHash: ZERO_HASH, globalContractHash: GLOBAL_HASH, globalContractAccountId: null };
const local: ViewAccount = { exists: true, blockHeight: 100, codeHash: LOCAL_HASH, globalContractHash: null, globalContractAccountId: null };
const byAccount: ViewAccount = { exists: true, blockHeight: 100, codeHash: ZERO_HASH, globalContractHash: null, globalContractAccountId: "owner.testnet" };
const noCode: ViewAccount = { exists: true, blockHeight: 100, codeHash: ZERO_HASH, globalContractHash: null, globalContractAccountId: null };

describe("classify", () => {
  it("by hash + function-call keys present + clean imports → immutable_verified", async () => {
    const c = await classify(ID, reader({ account: byHash, keys: ["function_call", "function_call"], code: moduleWith(CLEAN), codeHash: GLOBAL_HASH }));
    expect(c.class).toBe("immutable_verified");
    expect(c.evidence).toEqual({
      accountId: ID,
      checkedAtBlock: 100,
      codeRef: { kind: "global_hash", globalHash: GLOBAL_HASH },
      fullAccessKeyCount: 0,
      functionCallKeyCount: 2,
      monitoredCodeHash: ZERO_HASH,
      resolvedCodeHash: GLOBAL_HASH,
      upgradeImports: [],
      mutabilityBasis: "no_detected_path",
      wasmParsed: true,
    });
  });

  it("by hash + no full-access keys + a deploy import → local_upgradeable, basis upgrade_imports", async () => {
    const c = await classify(ID, reader({ account: byHash, code: moduleWith([...CLEAN, ...funcs("promise_batch_action_deploy_contract")]) }));
    expect(c.class).toBe("local_upgradeable");
    expect(c.evidence.mutabilityBasis).toBe("upgrade_imports");
    expect(c.evidence.upgradeImports).toEqual(["promise_batch_action_deploy_contract"]);
  });

  it("by hash + no full-access keys + a delete-account import → local_upgradeable", async () => {
    const c = await classify(ID, reader({ account: byHash, code: moduleWith(funcs("promise_batch_action_delete_account")) }));
    expect(c.class).toBe("local_upgradeable");
    expect(c.evidence.mutabilityBasis).toBe("upgrade_imports");
    expect(c.evidence.upgradeImports).toEqual(["promise_batch_action_delete_account"]);
  });

  it("by hash + no full-access keys + a full-access gas key import → local_upgradeable", async () => {
    const c = await classify(ID, reader({ account: byHash, code: moduleWith(funcs("promise_batch_action_add_gas_key_with_full_access")) }));
    expect(c.class).toBe("local_upgradeable");
    expect(c.evidence.upgradeImports).toEqual(["promise_batch_action_add_gas_key_with_full_access"]);
  });

  it("reports every scanned import found, in module order", async () => {
    const scanned = funcs(
      "promise_batch_action_use_global_contract_by_account_id",
      "promise_batch_action_add_key_with_full_access",
      "promise_batch_action_use_global_contract",
    );
    const c = await classify(ID, reader({ account: byHash, code: moduleWith([...CLEAN, ...scanned]) }));
    expect(c.evidence.upgradeImports).toEqual(scanned.map((s) => s.name));
  });

  it("local code + a full-access key + scanned imports → basis full_access_key", async () => {
    const c = await classify(ID, reader({ account: local, keys: ["full_access"], code: moduleWith(funcs("promise_batch_action_deploy_contract")) }));
    expect(c.class).toBe("local_upgradeable");
    expect(c.evidence.mutabilityBasis).toBe("full_access_key");
    expect(c.evidence.upgradeImports).toEqual(["promise_batch_action_deploy_contract"]);
    expect(c.evidence.codeRef).toEqual({ kind: "local", codeHash: LOCAL_HASH });
  });

  it("local code + no keys + clean imports → local_upgradeable, basis own_code", async () => {
    const c = await classify(ID, reader({ account: local, code: moduleWith(CLEAN), codeHash: LOCAL_HASH }));
    expect(c.class).toBe("local_upgradeable");
    expect(c.evidence.mutabilityBasis).toBe("own_code");
  });

  it("by hash + a full-access key → local_upgradeable", async () => {
    const c = await classify(ID, reader({ account: byHash, keys: ["full_access", "function_call"], code: moduleWith(CLEAN) }));
    expect(c.class).toBe("local_upgradeable");
    expect(c.evidence.mutabilityBasis).toBe("full_access_key");
    expect(c.evidence.fullAccessKeyCount).toBe(1);
    expect(c.evidence.functionCallKeyCount).toBe(1);
  });

  it("counts a full-access gas key as a full-access key", async () => {
    const c = await classify(ID, reader({ account: byHash, keys: ["gas_key_full_access", "gas_key_function_call"], code: moduleWith(CLEAN) }));
    expect(c.class).toBe("local_upgradeable");
    expect(c.evidence.fullAccessKeyCount).toBe(1);
    expect(c.evidence.functionCallKeyCount).toBe(1);
  });

  it("references another account's global contract → global_by_account, resolved hash from view_code", async () => {
    const c = await classify(ID, reader({ account: byAccount, code: moduleWith(CLEAN), codeHash: RESOLVED_HASH }));
    expect(c.class).toBe("global_by_account");
    expect(c.evidence.mutabilityBasis).toBe("global_owner");
    expect(c.evidence.codeRef).toEqual({ kind: "global_account", ownerAccount: "owner.testnet" });
    expect(c.evidence.monitoredCodeHash).toBe(ZERO_HASH);
    expect(c.evidence.resolvedCodeHash).toBe(RESOLVED_HASH);
    expect(c.evidence.resolvedCodeHash).not.toBe(c.evidence.monitoredCodeHash);
  });

  it("global_by_account stays global_by_account even with a full-access key and scanned imports", async () => {
    const c = await classify(ID, reader({ account: byAccount, keys: ["full_access"], code: moduleWith(funcs("promise_batch_action_deploy_contract")) }));
    expect(c.class).toBe("global_by_account");
    expect(c.evidence.fullAccessKeyCount).toBe(1);
  });

  it("checks global_contract_hash before global_contract_account_id", async () => {
    const both: ViewAccount = { ...byHash, globalContractAccountId: "owner.testnet" } as ViewAccount;
    const c = await classify(ID, reader({ account: both, code: moduleWith(CLEAN) }));
    expect(c.evidence.codeRef).toEqual({ kind: "global_hash", globalHash: GLOBAL_HASH });
  });

  it("unparseable WASM → unknown", async () => {
    const c = await classify(ID, reader({ account: local, code: "garbage" }));
    expect(c.class).toBe("unknown");
    expect(c.evidence.mutabilityBasis).toBe("undetermined");
    expect(c.evidence.wasmParsed).toBe(false);
    expect(c.evidence.resolvedCodeHash).toBe(RESOLVED_HASH);
  });

  it("code that view_code cannot return → unknown", async () => {
    const c = await classify(ID, reader({ account: byHash, code: "unavailable" }));
    expect(c.class).toBe("unknown");
    expect(c.evidence.wasmParsed).toBe(false);
  });

  it("a full-access key decides before an unparseable module", async () => {
    const c = await classify(ID, reader({ account: local, keys: ["full_access"], code: "garbage" }));
    expect(c.class).toBe("local_upgradeable");
    expect(c.evidence.mutabilityBasis).toBe("full_access_key");
    expect(c.evidence.wasmParsed).toBe(false);
  });

  it("an account with no contract → unknown, and not confused with a global-contract account", async () => {
    const r = reader({ account: noCode, keys: ["full_access"], code: moduleWith(CLEAN) });
    const c = await classify(ID, r);
    expect(c.class).toBe("unknown");
    expect(c.evidence.mutabilityBasis).toBe("undetermined");
    expect(c.evidence.codeRef).toBeNull();
    expect(c.evidence.monitoredCodeHash).toBe(ZERO_HASH);
    expect(c.evidence.fullAccessKeyCount).toBe(1);
    expect(r.calls).not.toContain("viewCode");
  });

  it("an account that does not exist → unknown, with no further reads", async () => {
    const r = reader({ account: { exists: false, blockHeight: 77 } });
    const c = await classify(ID, r);
    expect(c.class).toBe("unknown");
    expect(c.evidence.checkedAtBlock).toBe(77);
    expect(c.evidence.monitoredCodeHash).toBeNull();
    expect(r.calls).toEqual(["viewAccount"]);
  });

  it("function-call AddKey and DeleteKey imports do not disqualify", async () => {
    const c = await classify(ID, reader({
      account: byHash,
      code: moduleWith([...CLEAN, ...funcs("promise_batch_action_add_key_with_function_call", "promise_batch_action_delete_key")]),
    }));
    expect(c.class).toBe("immutable_verified");
  });

  it("review-pending imports do not change the class in v0", async () => {
    const c = await classify(ID, reader({ account: byHash, code: moduleWith(funcs("promise_batch_action_state_init")) }));
    expect(c.class).toBe("immutable_verified");
  });

  it.each(["viewAccount", "viewAccessKeyList", "viewCode"] as const)(
    "a transport failure in %s rejects instead of returning unknown",
    async (fail) => {
      await expect(classify(ID, reader({ account: local, code: moduleWith(CLEAN), fail }))).rejects.toThrow(/transport/);
    },
  );
});
