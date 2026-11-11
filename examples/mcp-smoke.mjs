// Starts the built MCP server (packages/mcp) over stdio, as an MCP client would, against the real
// testnet coverage stack and a real agent key, and calls the tools an agent uses.
//   node examples/mcp-smoke.mjs <agent label>     the label coverage-demo.ts printed
// Testnet only. The agent key is read from ~/.near-credentials/aruna-agents/<vault>/<label>.json and
// never leaves this machine.
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PARENT = process.env.ARUNA_TESTNET_ACCOUNT ?? "arunafi.testnet";
const VAULT = `demo4.factory2.${PARENT}`;
const TARGET = `drift-target.${PARENT}`;
const label = process.argv[2];
if (!label) throw new Error("usage: node examples/mcp-smoke.mjs <agent label>");

const transport = new StdioClientTransport({
  command: "node",
  args: [join(import.meta.dirname, "../packages/mcp/dist/index.js")],
  env: {
    ...process.env,
    ARUNA_REGISTRY: `registry2.${PARENT}`,
    ARUNA_POOL: `pool2.${PARENT}`,
    ARUNA_AGENT_VAULT: VAULT,
    ARUNA_AGENT_KEY_FILE: join(homedir(), ".near-credentials", "aruna-agents", VAULT, `${label}.json`),
  },
});
const client = new Client({ name: "aruna-smoke", version: "0" });
await client.connect(transport);

const say = (title, r) => console.log(`\n${title}\n   ${r.isError ? "TOOL ERROR: " : ""}${r.content[0].text.replace(/\n/g, "\n   ")}`);
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
console.log("tools:", tools.join(", "));
if (tools.some((n) => /buy|claim|key|purchase|withdraw/.test(n))) throw new Error("a purchase or key tool is exposed");

const action = { adapter: "swap", target: TARGET, amount: "50000000000000000000000", min_amount_out: "49500000000000000000000" };
say("aruna_watch_target", await client.callTool({ name: "aruna_watch_target", arguments: { account_id: TARGET, network: "testnet" } }));
say("aruna_budget", await client.callTool({ name: "aruna_budget", arguments: {} }));
say("aruna_simulate (with a coverage shape)", await client.callTool({ name: "aruna_simulate", arguments: { ...action, coverage: { limit: "1000000000000000000000000", payout_ratio_bps: 8000, window_blocks: 43200 } } }));
say("aruna_spend", await client.callTool({ name: "aruna_spend", arguments: action }));
say("aruna_pool_book (near)", await client.callTool({ name: "aruna_pool_book", arguments: { token: "near" } }));
say("aruna_drift_report", await client.callTool({ name: "aruna_drift_report", arguments: { target: TARGET } }));
await client.close();
