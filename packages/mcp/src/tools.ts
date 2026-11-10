// Group A of docs/MCP.md (keyless, vault-free) and the one keyless read of Group B, aruna_read_vault.
// Handlers only shape arguments and results; the logic lives in @aruna/sdk.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Classifier, readVault, type Network, type RiskClass, type VaultView } from "@aruna/sdk";
import { z } from "zod";

const CLASSES = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"] as const;

type ReadVault = (vault: string, network: Network) => Promise<VaultView>;

const near = (yocto: string) => {
  const v = BigInt(yocto);
  return `${v / 10n ** 24n}.${(v % 10n ** 24n).toString().padStart(24, "0").slice(0, 4)} NEAR`;
};

/** A plain-text summary of a vault: who controls it, its limits, each agent, and what nobody can do. */
export function describeVault(v: VaultView): string {
  const lines = [`${v.vault}: owner ${v.owner}, operator ${v.operator ?? "none"}, full-access keys ${v.fullAccessKeys}.`];
  if (v.ceiling) {
    const c = v.ceiling;
    lines.push(`Ceiling: max ${near(c.maxPerTx)} per transaction, ${near(c.dailyTotal)} a day across agents, targets up to ${c.maxRiskClass}: ${c.allowedTargets.join(", ")}.`);
  }
  for (const a of v.agents) {
    const usage = a.usage ? `, spent today ${near(a.usage.spentToday)}, reserved ${near(a.usage.reserved)}` : "";
    lines.push(`Agent ${a.label} (${a.publicKey}): ${a.status}${a.autoDisabled ? ", auto-disabled after repeated refusals" : ""}; max ${near(a.policy.maxPerTx)} per transaction, ${near(a.policy.dailyCap)} a day, targets up to ${a.policy.maxRiskClass}: ${a.policy.allowedTargets.join(", ")}${usage}.`);
    lines.push(`  Cannot: ${a.cannot.join("; ")}.`);
  }
  if (v.exposure) lines.push(v.exposure.length ? `Exposure: ${v.exposure.map((e) => `${near(e.amount)} to ${e.target} (recorded as ${e.classAtRecord})`).join("; ")}.` : "Exposure: none recorded.");
  if (v.unknownKeys.length) lines.push(`WARNING: keys the vault does not know as agents: ${v.unknownKeys.join(", ")}.`);
  lines.push(`The operator cannot: ${v.operatorCannot.join("; ")}.`);
  return lines.join("\n");
}

export function registerTools(
  server: McpServer,
  make: (network: Network) => Classifier = (network) => new Classifier({ network }),
  read: ReadVault = (vault, network) => readVault(vault, { network }),
) {
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

  server.registerTool(
    "aruna_read_vault",
    {
      title: "What can this Aruna vault's agents do?",
      description:
        "Reads an Aruna vault's public state: owner, operator, the owner's ceiling, every agent with its policy, status and usage, the agent keys exactly as the network enforces them, what each agent and the operator cannot do, and settled exposure per target. Read-only and keyless: no account or agent key needed. It does not spend or simulate.",
      inputSchema: {
        vault_id: z.string().describe("NEAR account id of the vault, e.g. demo2.factory.arunafi.testnet"),
        network: z.enum(["mainnet", "testnet"]).default("testnet").describe("Which network to read; v0 vaults are on testnet"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ vault_id, network }) => {
      try {
        const v = await read(vault_id, network);
        return { content: [{ type: "text", text: describeVault(v) }], structuredContent: v as unknown as Record<string, unknown> };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: "text", text: `Could not read vault ${vault_id} on ${network}: ${msg}. It may not be an Aruna vault.` }] };
      }
    },
  );
}
