import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Classifier, type VaultView } from "@aruna/sdk";
import type { RpcReader } from "@aruna/classifier-core";
import { registerTools } from "../src/tools.js";

const ZERO = "11111111111111111111111111111111";
const byAccount: RpcReader = {
  viewAccount: async () => ({ exists: true, blockHeight: 9, codeHash: ZERO, globalContractHash: null, globalContractAccountId: "owner.testnet" }),
  viewAccessKeyList: async () => ({ keys: [] }),
  viewCode: async () => ({ codeBase64: "AGFzbQEAAAA=", hash: "R" }),
};
const failing: RpcReader = { ...byAccount, viewAccount: async () => Promise.reject(new Error("every RPC endpoint failed")) };

const VAULT: VaultView = {
  vault: "v.factory.testnet",
  owner: "client.testnet",
  operator: "company.testnet",
  shape: "per-token",
  ceiling: { tokens: [{ token: "near", maxPerTx: "1000000000000000000000000", dailyTotal: "3000000000000000000000000" }, { token: "usdc.testnet", maxPerTx: "10000000", dailyTotal: "40000000" }], maxRiskClass: "local_upgradeable", allowedTargets: ["swap.testnet"], agentAllowance: "1" },
  exposure: [{ target: "swap.testnet", token: "near", amount: "200000000000000000000000", classAtRecord: "local_upgradeable" }, { target: "swap.testnet", token: "usdc.testnet", amount: "4000000", classAtRecord: "local_upgradeable" }],
  fullAccessKeys: 0,
  agents: [
    {
      publicKey: "ed25519:I",
      label: "injected",
      status: "Paused",
      autoDisabled: true,
      policy: { limits: [{ token: "near", maxPerTx: "200000000000000000000000", dailyCap: "1000000000000000000000000" }], maxSlippageBps: 100, allowedTargets: ["swap.testnet"], maxRiskClass: "local_upgradeable" },
      policyVersion: 1,
      lastLoosenedAt: 0,
      usage: [{ token: "near", spentToday: "0", reserved: "0" }],
      key: { receiver: "v.factory.testnet", methods: ["spend", "refresh_class"], allowance: "1" },
      cannot: ["call any method other than spend, refresh_class (MethodNameMismatch)"],
    },
  ],
  unknownKeys: [],
  operatorCannot: ["resume a paused or auto-disabled agent"],
};

async function connect(reader: RpcReader, read: (vault: string) => Promise<VaultView> = async () => VAULT) {
  const server = new McpServer({ name: "aruna-test", version: "0" });
  registerTools(server, () => new Classifier({ reader }), read);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("MCP tools", () => {
  it("lists the three keyless tools, all read-only", async () => {
    const client = await connect(byAccount);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["aruna_check_target", "aruna_explain_class", "aruna_read_vault"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("aruna_read_vault summarizes agents, limits and exposure, with the full view as structured content", async () => {
    const client = await connect(byAccount);
    const r = await client.callTool({ name: "aruna_read_vault", arguments: { vault_id: "v.factory.testnet" } });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { text: string }[])[0].text;
    expect(text).toMatch(/full-access keys 0/);
    expect(text).toMatch(/Agent injected .*Paused, auto-disabled/);
    expect(text).toMatch(/max 0\.2000 NEAR per transaction/);
    expect(text).toMatch(/Exposure: 0\.2000 NEAR to swap\.testnet \(recorded as local_upgradeable\); 4000000 usdc\.testnet units to swap\.testnet/);
    expect(text).toMatch(/usdc\.testnet: max 10000000 usdc\.testnet units per transaction/);
    expect((r.structuredContent as unknown as VaultView).agents[0].autoDisabled).toBe(true);
  });

  it("aruna_read_vault reports a failed read as a tool error", async () => {
    const client = await connect(byAccount, () => Promise.reject(new Error("get_config: MethodNotFound")));
    const r = await client.callTool({ name: "aruna_read_vault", arguments: { vault_id: "wrap.testnet" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/may not be an Aruna vault/);
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
