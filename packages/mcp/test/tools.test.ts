import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Classifier } from "@aruna/sdk";
import type { RpcReader } from "@aruna/classifier-core";
import { registerTools } from "../src/tools.js";

const ZERO = "11111111111111111111111111111111";
const byAccount: RpcReader = {
  viewAccount: async () => ({ exists: true, blockHeight: 9, codeHash: ZERO, globalContractHash: null, globalContractAccountId: "owner.testnet" }),
  viewAccessKeyList: async () => ({ keys: [] }),
  viewCode: async () => ({ codeBase64: "AGFzbQEAAAA=", hash: "R" }),
};
const failing: RpcReader = { ...byAccount, viewAccount: async () => Promise.reject(new Error("every RPC endpoint failed")) };

async function connect(reader: RpcReader) {
  const server = new McpServer({ name: "aruna-test", version: "0" });
  registerTools(server, () => new Classifier({ reader }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("MCP tools", () => {
  it("lists both keyless tools", async () => {
    const client = await connect(byAccount);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["aruna_check_target", "aruna_explain_class"]);
  });

  it("aruna_check_target returns the class, reason and evidence", async () => {
    const client = await connect(byAccount);
    const r = await client.callTool({ name: "aruna_check_target", arguments: { account_id: "u.testnet", network: "testnet" } });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as { class: string }).class).toBe("global_by_account");
    expect((r.content as { text: string }[])[0].text).toMatch(/global_by_account/);
  });

  it("a failed read is a tool error that says nothing was classified, not a crash", async () => {
    const client = await connect(failing);
    const r = await client.callTool({ name: "aruna_check_target", arguments: { account_id: "u.testnet" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/do not treat this as safe/);
  });

  it("aruna_explain_class explains a class", async () => {
    const client = await connect(byAccount);
    const r = await client.callTool({ name: "aruna_explain_class", arguments: { class: "unknown" } });
    expect((r.content as { text: string }[])[0].text).toMatch(/^unknown:/);
  });
});
