import { describe, expect, it } from "vitest";
import type { RpcReader, ViewAccount } from "@aruna/classifier-core";
import { aggregate, parseAccountsCsv, runMeasure } from "../src/measure-cmd.js";

const ZERO = "11111111111111111111111111111111";
// Smallest valid module with no imports: magic + version.
const EMPTY_MODULE_B64 = "AGFzbQEAAAA=";

const accounts: Record<string, ViewAccount> = {
  "imm.testnet": { exists: true, blockHeight: 10, codeHash: ZERO, globalContractHash: "H", globalContractAccountId: null },
  "own.testnet": { exists: true, blockHeight: 11, codeHash: "L", globalContractHash: null, globalContractAccountId: null },
  "glob.testnet": { exists: true, blockHeight: 12, codeHash: ZERO, globalContractHash: null, globalContractAccountId: "owner.testnet" },
  "none.testnet": { exists: true, blockHeight: 13, codeHash: ZERO, globalContractHash: null, globalContractAccountId: null },
};

function fakeReader(opts: { failFor?: string; flakyOnce?: string } = {}): RpcReader {
  let flaked = false;
  return {
    async viewAccount(id) {
      if (id === opts.failFor) throw new Error("transport: down");
      if (id === opts.flakyOnce && !flaked) {
        flaked = true;
        throw new Error("transport: flaky");
      }
      return accounts[id];
    },
    async viewAccessKeyList() {
      return { keys: [] };
    },
    async viewCode() {
      return { codeBase64: EMPTY_MODULE_B64, hash: "R" };
    },
  };
}

describe("parseAccountsCsv", () => {
  it("reads account_id and an optional call count, ignoring quotes and blank lines", () => {
    const rows = parseAccountsCsv('account_id,calls\n"imm.testnet",42\nown.testnet,7\n\n');
    expect(rows).toEqual([
      { accountId: "imm.testnet", calls: 42 },
      { accountId: "own.testnet", calls: 7 },
    ]);
  });

  it("accepts BigQuery's receipt_receiver_account_id column name", () => {
    expect(parseAccountsCsv("receipt_receiver_account_id\nwrap.near\n")).toEqual([{ accountId: "wrap.near", calls: null }]);
  });

  it("rejects a file with no account column", () => {
    expect(() => parseAccountsCsv("foo,bar\n1,2\n")).toThrow(/account_id/);
  });
});

describe("runMeasure", () => {
  it("classifies every row, in input order", async () => {
    const rows = ["imm.testnet", "own.testnet", "glob.testnet"].map((accountId) => ({ accountId, calls: null }));
    const results = await runMeasure(rows, fakeReader(), { concurrency: 2, retries: 0 });
    expect(results.map((r) => r.accountId)).toEqual(["imm.testnet", "own.testnet", "glob.testnet"]);
    expect(results.map((r) => (r.ok ? r.classification.class : "failed"))).toEqual([
      "immutable_verified",
      "local_upgradeable",
      "global_by_account",
    ]);
  });

  it("an account whose reads keep failing is listed as failed, not as unknown", async () => {
    const rows = [{ accountId: "own.testnet", calls: null }, { accountId: "imm.testnet", calls: null }];
    const results = await runMeasure(rows, fakeReader({ failFor: "own.testnet" }), { concurrency: 1, retries: 1, backoffMs: 1 });
    expect(results[0]).toMatchObject({ accountId: "own.testnet", ok: false });
    const agg = aggregate(results);
    expect(agg.failed).toEqual(["own.testnet"]);
    expect(agg.byClass.unknown).toBe(0);
    expect(agg.classified).toBe(1);
  });

  it("retries a transient failure", async () => {
    const results = await runMeasure([{ accountId: "imm.testnet", calls: null }], fakeReader({ flakyOnce: "imm.testnet" }), {
      concurrency: 1,
      retries: 1,
      backoffMs: 1,
    });
    expect(results[0].ok).toBe(true);
  });
});

describe("aggregate", () => {
  it("counts sum to the input, with both headlines and upgrade_imports apart", async () => {
    const rows = ["imm.testnet", "own.testnet", "glob.testnet", "none.testnet"].map((accountId) => ({ accountId, calls: null }));
    const agg = aggregate(await runMeasure(rows, fakeReader(), { concurrency: 4, retries: 0 }));
    expect(agg.total).toBe(4);
    expect(agg.classified).toBe(4);
    expect(agg.byClass).toEqual({ immutable_verified: 1, local_upgradeable: 1, global_by_account: 1, unknown: 1 });
    expect(agg.byBasis).toEqual({
      no_detected_path: 1,
      full_access_key: 0,
      upgrade_imports: 0,
      own_code: 1,
      global_owner: 1,
      undetermined: 1,
    });
    expect(agg.headline1).toEqual({ globalByAccount: 1, of: 4, share: 0.25 });
    expect(agg.headline2).toEqual({ canChange: 2, immutableVerified: 1, upgradeImportsReportedSeparately: 0, unknown: 1, of: 4 });
    expect(agg.blockRange).toEqual({ min: 10, max: 13 });
  });

  it("is byte-identical across runs on the same input", async () => {
    const rows = ["glob.testnet", "imm.testnet", "own.testnet"].map((accountId) => ({ accountId, calls: null }));
    const a = JSON.stringify(aggregate(await runMeasure(rows, fakeReader(), { concurrency: 3, retries: 0 })));
    const b = JSON.stringify(aggregate(await runMeasure(rows, fakeReader(), { concurrency: 1, retries: 0 })));
    expect(a).toBe(b);
  });
});
