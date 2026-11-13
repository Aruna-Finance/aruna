import { describe, expect, it } from "vitest";
import { createTestnetReads } from "./chain-reads";

const reply = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 502, json: async () => body })) as unknown as typeof fetch;

describe("testnet reads", () => {
  it("decodes a contract view", async () => {
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify({ a: 1 })));
    const r = createTestnetReads(reply({ result: { result: bytes } }));
    expect(await r.view("c.testnet", "m", {})).toEqual({ a: 1 });
  });
  it("turns a contract error into an Error, not a value", async () => {
    const r = createTestnetReads(reply({ result: { error: "MethodNotFound" } }));
    await expect(r.view("c.testnet", "m", {})).rejects.toThrow(/MethodNotFound/);
  });
  it("reports an unknown account as null balance, and a transport failure as an error", async () => {
    const none = createTestnetReads(reply({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } }));
    expect(await none.balance("x.testnet")).toBeNull();
    const down = createTestnetReads(reply({}, false));
    await expect(down.balance("x.testnet")).rejects.toThrow(/502/);
  });
  it("reads a balance and the global contract hash", async () => {
    const r = createTestnetReads(reply({ result: { amount: "42", global_contract_hash: "H", storage_usage: 7 } }));
    expect(await r.balance("x.testnet")).toBe(42n);
    expect(await r.account("x.testnet")).toEqual({ amount: "42", globalContractHash: "H", storageUsage: 7 });
  });
});
