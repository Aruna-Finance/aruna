import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ArunaAuthError, type AgentVault } from "@aruna/sdk/vault";
import { registerAgentTools } from "../src/agent-tools.js";

async function connect(vault: Partial<AgentVault>) {
  const server = new McpServer({ name: "t", version: "0" });
  registerAgentTools(server, vault as AgentVault);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const args = { adapter: "swap", target: "t.testnet", amount: "10", min_amount_out: "10" };
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content)[0].text;

describe("agent tools (Group B)", () => {
  it("lists exactly the four agent tools, and no coverage purchase", async () => {
    const c = await connect({});
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["aruna_budget", "aruna_exposure", "aruna_simulate", "aruna_spend"]);
  });

  it("a refusal is a successful call with verdict block and the reason", async () => {
    const c = await connect({ spend: async () => ({ ok: false as const, reason: "TARGET_NOT_ALLOWED" as const, targetClass: null, tx: "T" }) });
    const r = await c.callTool({ name: "aruna_spend", arguments: args });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ verdict: "block", reason: "TARGET_NOT_ALLOWED" });
    expect(textOf(r)).toMatch(/Do not retry/);
  });

  it("an authorization failure is a tool error", async () => {
    const c = await connect({ spend: async () => Promise.reject(new ArunaAuthError("Smart contract panicked: ARUNA_UNKNOWN_AGENT")) });
    const r = await c.callTool({ name: "aruna_spend", arguments: args });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/ARUNA_UNKNOWN_AGENT/);
  });

  it("simulate says it is not binding", async () => {
    const c = await connect({ simulate: async () => ({ verdict: "allow" as const, reason: null, targetClass: "local_upgradeable" }) });
    expect(textOf(await c.callTool({ name: "aruna_simulate", arguments: args }))).toMatch(/^allow .*Not binding/);
  });

  it("budget lists what remains per token", async () => {
    const c = await connect({ budget: async () => ({ balanceNear: "5", tokens: [{ token: "near", maxPerTx: "2", dailyCap: "10", spentToday: "3", reserved: "1", remaining: "6" }] }) });
    expect(textOf(await c.callTool({ name: "aruna_budget", arguments: {} }))).toMatch(/near: 6 left of 10 today/);
  });
});
