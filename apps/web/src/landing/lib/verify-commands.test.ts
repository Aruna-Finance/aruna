import { describe, expect, it } from "vitest";
import { curlFor, isSafeAccountId, rpcBody } from "./verify-commands";

describe("verify commands", () => {
  it("builds the documented query body", () => {
    expect(JSON.parse(rpcBody("view_code", "a.testnet"))).toEqual({
      jsonrpc: "2.0",
      id: "dontcare",
      method: "query",
      params: { request_type: "view_code", finality: "final", account_id: "a.testnet" },
    });
  });
  it("targets the network's endpoint", () => {
    expect(curlFor("view_account", "a.near", "mainnet")).toContain("free.rpc.fastnear.com");
    expect(curlFor("view_account", "a.testnet", "testnet")).toContain("test.rpc.fastnear.com");
  });
  it("rejects ids that could break out of the shell quoting", () => {
    expect(isSafeAccountId("router.testnet")).toBe(true);
    expect(isSafeAccountId("a'; rm -rf ~; '")).toBe(false);
  });
});
