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
/** NEAR in NEAR; a fungible token in its smallest unit, named by its contract. */
const amount = (value: string, token: string) => (token === "near" ? near(value) : `${value} ${token} units`);

/** A plain-text summary of a vault: who controls it, its limits per token, each agent, and what nobody can do. */
export function describeVault(v: VaultView): string {
  const lines = [`${v.vault}: owner ${v.owner}, operator ${v.operator ?? "none"}, full-access keys ${v.fullAccessKeys}.`];
  if (v.ceiling) {
    const c = v.ceiling;
    const per = (c.tokens ?? [{ token: "near", maxPerTx: c.maxPerTx, dailyTotal: c.dailyTotal }]).map((t) => `${t.token}: max ${amount(t.maxPerTx, t.token)} per transaction, ${amount(t.dailyTotal, t.token)} a day across agents`).join("; ");
    lines.push(`Ceiling: ${per}; targets up to ${c.maxRiskClass}: ${c.allowedTargets.join(", ")}.`);
  }
  for (const a of v.agents) {
    const limits = (a.policy.limits ?? [{ token: "near", maxPerTx: a.policy.maxPerTx, dailyCap: a.policy.dailyCap }]).map((l) => `${l.token}: max ${amount(l.maxPerTx, l.token)} per transaction, ${amount(l.dailyCap, l.token)} a day`).join("; ") || "no token limits";
    const byToken = a.usageByToken ?? (a.usage ? [{ token: "near", ...a.usage }] : null);
    const usage = byToken?.length ? `; spent today ${byToken.map((u) => `${amount(u.spentToday, u.token)} (reserved ${amount(u.reserved, u.token)})`).join(", ")}` : "";
    lines.push(`Agent ${a.label} (${a.publicKey}): ${a.status}${a.autoDisabled ? ", auto-disabled after repeated refusals" : ""}; ${limits}; targets up to ${a.policy.maxRiskClass}: ${a.policy.allowedTargets.join(", ")}${usage}.`);
    lines.push(`  Cannot: ${a.cannot.join("; ")}.`);
  }
  const exposure = v.exposureByToken ?? v.exposure?.map((e) => ({ ...e, token: "near" }));
  if (exposure) lines.push(exposure.length ? `Exposure: ${exposure.map((e) => `${amount(e.amount, e.token ?? "near")} to ${e.target} (recorded as ${e.classAtRecord})`).join("; ")}.` : "Exposure: none recorded.");
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
