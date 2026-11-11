import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Pool, Registry, type ReadTransport } from "@aruna/sdk/coverage";
import type { AgentVault } from "@aruna/sdk/vault";
import { registerAgentTools } from "../src/agent-tools.js";
import { registerCoverageTools } from "../src/coverage-tools.js";
import { registerTools } from "../src/tools.js";

const KEY = "ed25519:AGENT";
const q = { premium: "55", days: 6, reachable_payout: "9", assumptions: { label: "UNDERWRITING ASSUMPTIONS, testnet" } };
const vaultView = { agents: [{ publicKey: KEY, policy: { maxPerTx: "1", dailyCap: "7" } }] };

function chain(over: Record<string, unknown> = {}) {
  const t: ReadTransport = {
    view: async <T>(_c: string, m: string, a: Record<string, unknown>) => {
      const table: Record<string, unknown> = {
        get_class: { class: "global_by_account", resolved_code_hash: "H" },
        quote: q,
        get_book: { capital: "100", total_shares: "100", total_limits: "40", locked_until: 9 },
        get_coverage: a.id === 1 ? { id: 1, target: "t.testnet", token: "near", limit: "10", paid_out: "0", end_block: 99, vault: "v.testnet", owner: "o.testnet" } : null,
        coverage_count: 2,
        latest_report: { id: 5, state: "Verified", reported_at_block: 7 },
        get_report: null,
        ...over,
      };
      return table[m] as T;
    },
  };
  const registry = new Registry({ registry: "reg", transport: t });
  const pool = new Pool({ pool: "pool", transport: t });
  return { registry, pool, quote: { registry, pool, readVault: async () => vaultView as never } };
}

async function connect(wire: (s: McpServer) => void) {
  const server = new McpServer({ name: "t", version: "0" });
  wire(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content)[0].text;
const quoteArgs = { target: "t.testnet", vault_id: "v.testnet", agent_public_key: KEY, token: "near", limit: "10", payout_ratio_bps: 8000, window_blocks: 4000 };

describe("coverage tools (Group C)", () => {
  it("quote returns the pool's premium with its inputs and the assumptions label", async () => {
    const c = await connect((s) => registerCoverageTools(s, chain()));
    const r = await c.callTool({ name: "aruna_coverage_quote", arguments: quoteArgs });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/Premium 55 near/);
    expect(textOf(r)).toMatch(/UNDERWRITING ASSUMPTIONS/);
    expect(r.structuredContent).toMatchObject({ ok: true, inputs: { dailyCap: "7", class: "global_by_account" } });
  });

  it("an unrecorded target is a successful call carrying the refusal, not a tool error", async () => {
    const c = await connect((s) => registerCoverageTools(s, chain({ get_class: null })));
    const r = await c.callTool({ name: "aruna_coverage_quote", arguments: quoteArgs });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ ok: false, reason: "no_class_record" });
  });

  it("an RPC failure is a tool error", async () => {
    const t: ReadTransport = { view: async () => Promise.reject(new Error("node down")) };
    const dead = { registry: new Registry({ registry: "r", transport: t }), pool: new Pool({ pool: "p", transport: t }), quote: { registry: new Registry({ registry: "r", transport: t }), pool: new Pool({ pool: "p", transport: t }) } };
    const c2 = await connect((s) => registerCoverageTools(s, dead));
    const r = await c2.callTool({ name: "aruna_pool_book", arguments: { token: "near" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/node down/);
  });

  it("book, coverage and drift report read the pool and registry", async () => {
    const c = await connect((s) => registerCoverageTools(s, chain()));
    expect(textOf(await c.callTool({ name: "aruna_pool_book", arguments: { token: "near" } }))).toMatch(/capital 100, limits sold 40/);
    expect(textOf(await c.callTool({ name: "aruna_coverage", arguments: { coverage_id: 1 } }))).toMatch(/#1 on t\.testnet/);
    expect(textOf(await c.callTool({ name: "aruna_coverage", arguments: { vault_id: "v.testnet" } }))).toMatch(/#1 on t\.testnet/);
    expect(textOf(await c.callTool({ name: "aruna_coverage", arguments: {} }))).toMatch(/exactly one/);
    expect(textOf(await c.callTool({ name: "aruna_drift_report", arguments: { target: "t.testnet" } }))).toMatch(/report #5: Verified/);
  });
});

describe("aruna_simulate with a coverage shape", () => {
  const sim = { simulate: async () => ({ verdict: "allow" as const, reason: null, targetClass: "global_by_account" }) } as unknown as AgentVault;
  const action = { adapter: "swap", target: "t.testnet", amount: "10", min_amount_out: "10" };

  it("returns the quote beside the verdict, naming the shape the caller gave", async () => {
    const seen: unknown[] = [];
    const c = await connect((s) =>
      registerAgentTools(s, sim, async (a, shape) => (seen.push([a.target, shape]), { ok: true as const, quote: q as never, inputs: {} as never })),
    );
    const r = await c.callTool({ name: "aruna_simulate", arguments: { ...action, coverage: { limit: "10", payout_ratio_bps: 8000, window_blocks: 4000 } } });
    expect(textOf(r)).toMatch(/^allow .*Not binding\.\nCoverage premium 55/s);
    expect(seen).toEqual([["t.testnet", { limit: "10", payoutRatioBps: 8000, windowBlocks: 4000 }]]);
  });

  it("without a coverage shape it is exactly as before and never asks for a quote", async () => {
    let asked = 0;
    const c = await connect((s) => registerAgentTools(s, sim, async () => (asked++, { ok: false as const, reason: "no_class_record" as const, detail: "" })));
    expect(textOf(await c.callTool({ name: "aruna_simulate", arguments: action }))).toMatch(/^allow .*Not binding\.$/s);
    expect(asked).toBe(0);
  });

  it("a refused quote does not turn the simulation into an error", async () => {
    const c = await connect((s) => registerAgentTools(s, sim, async () => ({ ok: false as const, reason: "no_daily_cap" as const, detail: "no cap" })));
    const r = await c.callTool({ name: "aruna_simulate", arguments: { ...action, coverage: { limit: "10", payout_ratio_bps: 8000, window_blocks: 4000 } } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/No coverage quote: no_daily_cap/);
  });
});

describe("no tool buys, claims or holds a key", () => {
  it("every tool the server can register is read-only or an agent action, and none is named buy, claim or key", async () => {
    const c = await connect((s) => {
      registerTools(s);
      registerCoverageTools(s, chain());
      registerAgentTools(s, {} as AgentVault, async () => ({ ok: false as const, reason: "no_daily_cap" as const, detail: "" }));
    });
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names).toContain("aruna_coverage_quote");
    for (const n of names) expect(n).not.toMatch(/buy|claim|key|purchase|withdraw/);
  });
});
