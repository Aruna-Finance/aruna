// Keyless, read-only coverage tools (docs/MCP.md Group C): prices, the pool's books, coverages and drift
// reports. Registered only when the server is told the registry and pool. There is no tool that buys
// or claims: coverage purchase is an owner action and is never reachable from here.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { quoteCoverage, type Pool, type QuoteDeps, type Registry } from "@aruna/sdk/coverage";
import { z } from "zod";

const text = (s: string, structured?: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: s }], ...(structured ? { structuredContent: structured } : {}) });
const toolError = (what: string, e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `${what} failed: ${e instanceof Error ? e.message : String(e)}` }] });
const amount = z.string().regex(/^\d+$/);

export function registerCoverageTools(server: McpServer, deps: { registry: Registry; pool: Pool; quote: QuoteDeps }) {
  server.registerTool(
    "aruna_coverage_quote",
    {
      title: "What would coverage on this agent's exposure to a target cost?",
      description:
        "The pool's premium for covering one agent's exposure to one target, in one token (each token is its own book, no conversion). It uses the target's recorded class and the agent's daily cap for that token from the vault policy, and returns every input and the labelled underwriting assumptions. A missing input is a refusal with a reason, never a zero premium. Read-only; buying coverage is an owner action and is not available here.",
      inputSchema: {
        target: z.string().describe("The covered target contract"),
        vault_id: z.string(),
        agent_public_key: z.string().describe("The agent's public key, as aruna_read_vault shows it"),
        token: z.string().default("near").describe('"near", or a NEP-141 token contract'),
        limit: amount.describe("Sum to insure, in the token's smallest unit"),
        payout_ratio_bps: z.number().int().min(1).max(10000),
        window_blocks: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (a) => {
      try {
        const q = await quoteCoverage(deps.quote, { target: a.target, vault: a.vault_id, agentPublicKey: a.agent_public_key, token: a.token, limit: a.limit, payoutRatioBps: a.payout_ratio_bps, windowBlocks: a.window_blocks });
        return q.ok
          ? text(`Premium ${q.quote.premium} ${a.token} for ${a.limit} insured over ${q.quote.days} UTC days (class ${q.inputs.class}, daily cap ${q.inputs.dailyCap}). ${q.quote.assumptions.label}.`, { ...q })
          : text(`No quote: ${q.reason} — ${q.detail}`, { ...q });
      } catch (e) {
        return toolError("coverage quote", e);
      }
    },
  );

  server.registerTool(
    "aruna_pool_book",
    {
      title: "What does the coverage pool hold in one token?",
      description: "One token's book: underwriter capital, total shares, total limits sold and the block before which capital cannot be withdrawn. Read-only.",
      inputSchema: { token: z.string().default("near").describe('"near", or a NEP-141 token contract') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ token }) => {
      try {
        const b = await deps.pool.book(token);
        return text(`${token}: capital ${b.capital}, limits sold ${b.total_limits}, shares ${b.total_shares}, locked until block ${b.locked_until}`, { token, ...b });
      } catch (e) {
        return toolError("pool book", e);
      }
    },
  );

  server.registerTool(
    "aruna_coverage",
    {
      title: "Coverage by id, or all coverage of a vault",
      description: "Reads coverage from the pool: one by id, or every coverage held for a vault. Read-only.",
      inputSchema: { coverage_id: z.number().int().min(0).optional(), vault_id: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ coverage_id, vault_id }) => {
      try {
        if ((coverage_id === undefined) === (vault_id === undefined)) return text("Give exactly one of coverage_id or vault_id.");
        const list = coverage_id !== undefined ? [await deps.pool.coverage(coverage_id)].filter((c) => c !== null) : await deps.pool.coverages({ vault: vault_id! });
        return text(list.length ? list.map((c) => `#${c.id} on ${c.target}: limit ${c.limit} ${typeof c.token === "string" ? c.token : c.token.ft}, paid out ${c.paid_out}, ends block ${c.end_block}`).join("\n") : "No coverage found.", { coverages: list });
      } catch (e) {
        return toolError("coverage", e);
      }
    },
  );

  server.registerTool(
    "aruna_drift_report",
    {
      title: "Has a drift report been filed for a target?",
      description: "The newest drift report for a target, or one by id, with its state as of now (pending, disputed, verified or rejected). Read-only.",
      inputSchema: { target: z.string().optional(), report_id: z.number().int().min(0).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ target, report_id }) => {
      try {
        if ((target === undefined) === (report_id === undefined)) return text("Give exactly one of target or report_id.");
        const r = report_id !== undefined ? await deps.registry.report(report_id) : await deps.registry.latestReport(target!);
        return text(r ? `report #${r.id}: ${r.state}, reported at block ${r.reported_at_block}` : "No drift report found.", { report: r });
      } catch (e) {
        return toolError("drift report", e);
      }
    },
  );
}
