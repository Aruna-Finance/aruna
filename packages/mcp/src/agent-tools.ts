// Group B of docs/MCP.md: tools for one agent, over @aruna/sdk/vault. Registered only when the server
// is configured with a vault and an existing agent key; the server never creates accounts or keys.
// A policy refusal is a SUCCESSFUL tool call returning verdict "block" with its reason. Only
// authorization and transport failures are tool errors (docs/MCP.md "Errors"). There is no
// coverage purchase here: that is an owner action, never reachable by an agent key.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentVault, SpendAction } from "@aruna/sdk/vault";
import { z } from "zod";

const actionShape = {
  adapter: z.enum(["swap", "ft_swap"]).describe("swap spends NEAR; ft_swap spends the token given in `token`"),
  target: z.string().describe("The target contract; it must be in the agent's policy"),
  amount: z.string().regex(/^\d+$/).describe("Amount in the token's smallest unit (yoctoNEAR for NEAR)"),
  min_amount_out: z.string().regex(/^\d+$/).describe("Least acceptable output, same unit"),
  token: z.string().optional().describe("Token contract, for ft_swap only"),
};
type ActionArgs = { adapter: "swap" | "ft_swap"; target: string; amount: string; min_amount_out: string; token?: string };
const toAction = (a: ActionArgs): SpendAction => ({ adapter: a.adapter, target: a.target, amount: a.amount, minAmountOut: a.min_amount_out, ...(a.token ? { token: a.token } : {}) });

const text = (s: string, structured?: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: s }], ...(structured ? { structuredContent: structured } : {}) });
const toolError = (what: string, e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `${what} failed: ${e instanceof Error ? e.message : String(e)}` }] });

export function registerAgentTools(server: McpServer, vault: AgentVault) {
  server.registerTool(
    "aruna_simulate",
    {
      title: "Would the vault allow this spend?",
      description:
        "Runs exactly the checks a spend runs, for this agent, without sending anything. Free and NOT binding: state can change before a spend lands. Returns verdict allow or block, the reason, and the target's recorded class. Needs vault v4.",
      inputSchema: actionShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (a) => {
      try {
        const s = await vault.simulate(toAction(a));
        return text(`${s.verdict}${s.reason ? `: ${s.reason}` : ""} (target class ${s.targetClass ?? "not recorded"}). Not binding.`, { ...s });
      } catch (e) {
        return toolError("simulate", e);
      }
    },
  );

  server.registerTool(
    "aruna_spend",
    {
      title: "Spend through the vault",
      description:
        "Spends through a named adapter on a target in the agent's policy. A refusal returns verdict block with its reason: do not retry it, a refusal means the agent must not do this. A stale target class is refreshed and retried once by the SDK.",
      inputSchema: actionShape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (a) => {
      try {
        const r = await vault.spend(toAction(a));
        if (r.ok) return text(`allowed: ${r.settled ? "settled" : "sent, but the target failed and the reservation was released"} (tx ${r.tx})`, { verdict: "allow", settled: r.settled, tx: r.tx });
        return text(`block: ${r.reason} (target class ${r.targetClass ?? "not recorded"}). Do not retry.`, { verdict: "block", reason: r.reason, targetClass: r.targetClass, tx: r.tx });
      } catch (e) {
        return toolError("spend", e);
      }
    },
  );

  server.registerTool(
    "aruna_budget",
    {
      title: "What can this agent still spend today?",
      description: "The agent's per-token limits, what it spent and has in flight today, what remains, and the vault's NEAR balance.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const b = await vault.budget();
        const lines = b.tokens.map((t) => `${t.token}: ${t.remaining} left of ${t.dailyCap} today (spent ${t.spentToday}, reserved ${t.reserved}, max ${t.maxPerTx} per transaction)`);
        return text([`vault NEAR balance ${b.balanceNear} yoctoNEAR`, ...lines].join("\n"), b as unknown as Record<string, unknown>);
      } catch (e) {
        return toolError("budget", e);
      }
    },
  );

  server.registerTool(
    "aruna_exposure",
    {
      title: "What has passed through the vault to each target?",
      description: "Recorded exposure per target and token, each with the target's class when it was recorded. What was sent, not the position's current value.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const ex = await vault.exposure();
        return text(ex.length ? ex.map((e) => `${e.amount} ${e.token ?? "near"} to ${e.target} (recorded as ${e.classAtRecord})`).join("\n") : "No exposure recorded.", { exposure: ex });
      } catch (e) {
        return toolError("exposure", e);
      }
    },
  );
}
