// Group A of docs/MCP.md: keyless, vault-free. Handlers only shape arguments and results; the logic
// lives in @aruna/sdk.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Classifier, type Network, type RiskClass } from "@aruna/sdk";
import { z } from "zod";

const CLASSES = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"] as const;

export function registerTools(server: McpServer, make: (network: Network) => Classifier = (network) => new Classifier({ network })) {
  const classifiers = new Map<Network, Classifier>();
  const classifierFor = (n: Network) => {
    let c = classifiers.get(n);
    if (!c) classifiers.set(n, (c = make(n)));
    return c;
  };

  server.registerTool(
    "aruna_check_target",
    {
      title: "Can this NEAR contract still change?",
      description:
        "Classifies any NEAR account by whether its code can still change under you: immutable_verified, local_upgradeable, global_by_account or unknown, with the evidence read from public RPC. No account, key or registration needed. Call it before an agent sends funds or calls to a contract. Hash-based monitoring is blind to global_by_account targets.",
      inputSchema: {
        account_id: z.string().describe("NEAR account id of the contract, e.g. wrap.near"),
        network: z.enum(["mainnet", "testnet"]).default("mainnet").describe("Which network to read"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ account_id, network }) => {
      try {
        const r = await classifierFor(network).check(account_id);
        const text = `${account_id} (${network}): ${r.class} — ${r.reason}\n\nEvidence:\n${JSON.stringify(r.evidence, null, 2)}`;
        return { content: [{ type: "text", text }], structuredContent: { class: r.class, reason: r.reason, evidence: r.evidence } };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: "text", text: `Could not classify ${account_id} on ${network}: ${msg}. Nothing was classified; do not treat this as safe.` }] };
      }
    },
  );

  server.registerTool(
    "aruna_explain_class",
    {
      title: "What does an Aruna class mean?",
      description: "Explains a mutability class and what can still change for a contract in it.",
      inputSchema: { class: z.enum(CLASSES).describe("The class returned by aruna_check_target") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ class: cls }) => ({ content: [{ type: "text", text: `${cls}: ${Classifier.explain(cls as RiskClass)}` }] }),
  );
}
