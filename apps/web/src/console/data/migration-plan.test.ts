import { describe, expect, it } from "vitest";
import { coverageWarning, defaultNewName, fundsSummary, migrateCommands, readOnlyMigrationTransport } from "./migration-plan";

describe("readOnlyMigrationTransport", () => {
  const reads = { view: async () => "v" as never, account: async () => ({ amount: "1", globalContractHash: null, storageUsage: 1 }) };
  it("reads, and refuses every method that would sign", async () => {
    const t = readOnlyMigrationTransport(reads, "owner.testnet");
    expect(t.signerId).toBe("owner.testnet");
    expect(await t.view("a", "b", {})).toBe("v");
    await expect(t.call("a", "b", {}, { depositYocto: 0n, tgas: 1n })).rejects.toThrow("does not send one");
    await expect(t.transfer("a", 1n)).rejects.toThrow("does not send one");
    await expect(t.callBatch("a", [])).rejects.toThrow("does not send one");
    await expect(t.txStatus("h")).rejects.toThrow("does not send one");
  });
});

describe("defaultNewName", () => {
  it("adds one to a trailing number, or appends 2", () => {
    expect(defaultNewName("demo2.factory.testnet")).toBe("demo3");
    expect(defaultNewName("l2ocbae.factory2.arunafi.testnet")).toBe("l2ocbae2");
  });
});

describe("migrateCommands", () => {
  const base = { oldVault: "old.f.testnet", name: "new1", factory: "f.testnet" };
  it("adds --accept-coverage-stays only when coverage is not none", () => {
    expect(migrateCommands({ ...base, coverage: { status: "none" } }, "me.testnet").run).not.toContain("--accept-coverage-stays");
    expect(migrateCommands({ ...base, coverage: { status: "active", coverageIds: [1] } }, "me.testnet").run).toContain("--accept-coverage-stays");
    expect(migrateCommands({ ...base, coverage: { status: "unchecked", reason: "x" } }, "me.testnet").run).toContain("--accept-coverage-stays");
  });
  it("gives a dry run that signs nothing", () => {
    expect(migrateCommands({ ...base, coverage: { status: "none" } }, "me.testnet").dryRun).toBe(
      "node packages/cli/dist/index.js migrate old.f.testnet --name new1 --factory f.testnet --as me.testnet --dry-run",
    );
  });
});

describe("coverageWarning", () => {
  it("names the coverage that stays, and treats an unread pool as active", () => {
    expect(coverageWarning({ status: "none" }).level).toBe("none");
    expect(coverageWarning({ status: "active", coverageIds: [2, 3] }).text).toContain("#2, #3");
    expect(coverageWarning({ status: "unchecked", reason: "rpc down" }).text).toContain("Treat it as active");
  });
});

describe("fundsSummary", () => {
  it("lists NEAR and non-empty tokens and what stays", () => {
    const s = fundsSummary({
      funds: {
        near: { balanceYocto: "0", keepYocto: (10n ** 22n).toString(), movableYocto: (3n * 10n ** 24n).toString() },
        tokens: [{ token: "usdc.testnet", balance: "500" }, { token: "empty.testnet", balance: "0" }],
      },
    });
    expect(s.moves).toEqual(["3 NEAR", "500 (smallest unit of usdc.testnet)"]);
    expect(s.keeps).toContain("0.01 NEAR");
  });
});
