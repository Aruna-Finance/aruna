#!/usr/bin/env node
// aruna-mcp — stdio MCP server. Keyless tools always; the agent tools of docs/MCP.md Group B only when
// ARUNA_AGENT_VAULT and ARUNA_AGENT_KEY_FILE name a vault and an existing agent key file (JSON with
// private_key, as examples/add-agents.ts writes). The server never creates keys or accounts.
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fetchViewTransport, Pool, quoteCoverage, Registry } from "@aruna/sdk/coverage";
import { AgentVault, nearApiTransport } from "@aruna/sdk/vault";
import { registerCoverageTools } from "./coverage-tools.js";
import { registerAgentTools } from "./agent-tools.js";
import { registerTools } from "./tools.js";

const server = new McpServer({ name: "aruna", version: "0.2.0" });
// Coverage reads (docs/MCP.md Group C) need the registry and the pool this deployment uses.
const registryId = process.env.ARUNA_REGISTRY;
const poolId = process.env.ARUNA_POOL;
const coverage = registryId && poolId ? (() => {
  const transport = fetchViewTransport({ network: "testnet" });
  const registry = new Registry({ registry: registryId, transport });
  const pool = new Pool({ pool: poolId, transport });
  return { registry, pool, quote: { registry, pool, network: "testnet" as const } };
})() : null;
registerTools(server, undefined, undefined, coverage?.registry);
if (coverage) registerCoverageTools(server, coverage);
const vaultId = process.env.ARUNA_AGENT_VAULT;
const keyFile = process.env.ARUNA_AGENT_KEY_FILE;
if (vaultId && keyFile) {
  if (!vaultId.endsWith(".testnet")) throw new Error("ARUNA_AGENT_VAULT must be a testnet vault");
  const privateKey = JSON.parse(readFileSync(keyFile, "utf8")).private_key as string;
  const agent = new AgentVault({ vaultId, transport: nearApiTransport({ signerId: vaultId, privateKey, rpcUrl: process.env.ARUNA_RPC_TESTNET?.split(",")[0] }) });
  registerAgentTools(
    server,
    agent,
    coverage ? async (action, shape) => quoteCoverage(coverage.quote, { target: action.target, vault: vaultId, agentPublicKey: await agent.publicKey(), token: action.adapter === "ft_swap" ? (action.token as string) : "near", ...shape }) : undefined,
  );
}
await server.connect(new StdioServerTransport());
