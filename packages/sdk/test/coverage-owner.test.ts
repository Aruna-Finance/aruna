import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_CLAIM_GAS_TGAS, OwnerCoverage, parseEvents } from "../src/coverage/index.js";
import { ArunaAuthError, ArunaRpcError, type CallResult, type VaultTransport } from "../src/vault/transport.js";

const repo = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
// The format the contracts emit (contracts/common/src/events.rs).
const ev = (event: string, data: unknown) => `EVENT_JSON:${JSON.stringify({ standard: "aruna", version: "1.0.0", event, data: [data] })}`;

function transport(result: Partial<CallResult> | Error) {
  const calls: { contract: string; method: string; args: Record<string, unknown>; deposit: bigint; tgas: bigint }[] = [];
  const t: VaultTransport = {
    signerId: "owner.testnet",
    view: async () => {
      throw new Error("no views here");
    },
    account: async () => ({ amount: "0", globalContractHash: null }),
    async call(contract, method, args, o) {
      calls.push({ contract, method, args, deposit: o.depositYocto, tgas: o.tgas });
      if (result instanceof Error) throw result;
      return { value: null, tx: "TX", ...result };
    },
  };
  return { t, calls };
}
const request = { vault: "v.testnet", agentPublicKey: "ed25519:AGENT", target: "t.testnet", limit: "10", payoutRatioBps: 8000, windowBlocks: 4000 };
const coverage = { id: 4, premium_paid: "123", owner: "owner.testnet" };

describe("parseEvents", () => {
  it("reads aruna events and ignores other logs and other standards", () => {
    const logs = ["some log", ev("coverage_refused", { reason: "x" }), `EVENT_JSON:${JSON.stringify({ standard: "nep141", event: "ft_transfer", data: [{}] })}`, "EVENT_JSON:{not json"];
    expect(parseEvents(logs)).toEqual([{ event: "coverage_refused", data: { reason: "x" } }]);
    expect(parseEvents(undefined)).toEqual([]);
  });
});

describe("OwnerCoverage.buy", () => {
  it("a NEAR purchase attaches maxPremium to buy_coverage and returns the coverage id and premium", async () => {
    const { t, calls } = transport({ logs: [ev("coverage_purchased", { coverage, quote: {} })] });
    const r = await new OwnerCoverage({ pool: "pool.testnet", transport: t }).buy({ request, token: "near", maxPremium: "500" });
    expect(r).toMatchObject({ ok: true, coverageId: 4, premium: "123", tx: "TX" });
    expect(calls[0]).toMatchObject({ contract: "pool.testnet", method: "buy_coverage", deposit: 500n });
    expect(calls[0]?.args).toEqual({ request: { vault: "v.testnet", agent: "ed25519:AGENT", target: "t.testnet", limit: "10", payout_ratio_bps: 8000, window_blocks: 4000 } });
  });

  it("an FT purchase is an ft_transfer_call on the token with the buy message and 1 yocto", async () => {
    const { t, calls } = transport({ logs: [ev("coverage_purchased", { coverage })] });
    await new OwnerCoverage({ pool: "pool.testnet", transport: t }).buy({ request, token: "usdc.testnet", maxPremium: "900" });
    expect(calls[0]).toMatchObject({ contract: "usdc.testnet", method: "ft_transfer_call", deposit: 1n });
    expect(calls[0]?.args).toMatchObject({ receiver_id: "pool.testnet", amount: "900" });
    expect(JSON.parse(String(calls[0]?.args.msg))).toMatchObject({ action: "buy", vault: "v.testnet", target: "t.testnet" });
  });

  it("a refusal, including a buyer who is not the owner, resolves with the contract's reason and throws nothing", async () => {
    const { t } = transport({ logs: [ev("coverage_refused", { buyer: "x.testnet", token: "near", reason: "only the vault's owner buys coverage" })] });
    expect(await new OwnerCoverage({ pool: "pool", transport: t }).buy({ request, token: "near", maxPremium: "500" })).toEqual({ ok: false, reason: "only the vault's owner buys coverage", tx: "TX" });
  });

  it("an authorization failure throws", async () => {
    const { t } = transport(new ArunaAuthError("ARUNA_X"));
    await expect(new OwnerCoverage({ pool: "pool", transport: t }).buy({ request, token: "near", maxPremium: "1" })).rejects.toBeInstanceOf(ArunaAuthError);
  });

  it("an outcome the logs do not show is never reported as success", async () => {
    const { t } = transport({ logs: [] });
    await expect(new OwnerCoverage({ pool: "pool", transport: t }).buy({ request, token: "near", maxPremium: "1" })).rejects.toBeInstanceOf(ArunaRpcError);
  });
});

describe("events are trusted only from the pool", () => {
  it("a token contract's fake coverage_purchased is not a purchase", async () => {
    const { t } = transport({ receipts: [{ executor: "evil-token.testnet", logs: [ev("coverage_purchased", { coverage })] }, { executor: "pool.testnet", logs: [ev("coverage_refused", { reason: "target is frozen" })] }] });
    expect(await new OwnerCoverage({ pool: "pool.testnet", transport: t }).buy({ request, token: "evil-token.testnet", maxPremium: "9" })).toMatchObject({ ok: false, reason: "target is frozen" });
  });

  it("with only a fake event from another contract, the outcome is unknown and throws", async () => {
    const { t } = transport({ receipts: [{ executor: "evil-token.testnet", logs: [ev("coverage_purchased", { coverage })] }] });
    await expect(new OwnerCoverage({ pool: "pool.testnet", transport: t }).buy({ request, token: "evil-token.testnet", maxPremium: "9" })).rejects.toBeInstanceOf(ArunaRpcError);
  });
});

describe("OwnerCoverage.claim", () => {
  it("returns the paid amount from the claim's final value", async () => {
    const { t, calls } = transport({ value: "80000", logs: [ev("claim_paid", { coverage: 4, report: 1 })] });
    expect(await new OwnerCoverage({ pool: "pool", transport: t }).claim({ coverageId: 4, reportId: 1 })).toEqual({ ok: true, paid: "80000", tx: "TX" });
    expect(calls[0]).toMatchObject({ method: "claim", args: { coverage_id: 4, report_id: 1 }, deposit: 0n });
    expect(calls[0]!.tgas).toBeGreaterThanOrEqual(MIN_CLAIM_GAS_TGAS);
  });

  it("a rejected claim resolves with the reason", async () => {
    const { t } = transport({ value: "0", logs: [ev("claim_rejected", { coverage: 4, report: 1, reason: "challenge window still open" })] });
    expect(await new OwnerCoverage({ pool: "pool", transport: t }).claim({ coverageId: 4, reportId: 1 })).toMatchObject({ ok: false, reason: "challenge window still open" });
  });

  it("too little gas is refused before anything is sent", async () => {
    const { t, calls } = transport({});
    await expect(new OwnerCoverage({ pool: "pool", transport: t }).claim({ coverageId: 4, reportId: 1, tgas: 100n })).rejects.toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(0);
  });

  it("a claim already paid or in flight throws (the contract panics)", async () => {
    const { t } = transport(new ArunaAuthError("ARUNA_ALREADY_PAID"));
    await expect(new OwnerCoverage({ pool: "pool", transport: t }).claim({ coverageId: 4, reportId: 1 })).rejects.toBeInstanceOf(ArunaAuthError);
  });
});

describe("what keeps coverage purchase away from agents", () => {
  it("the minimum claim gas equals the contract's", () => {
    const params = readFileSync(repo("contracts/common/src/params.rs"), "utf8");
    expect(params).toMatch(new RegExp(`MIN_CLAIM_GAS_TGAS: u64 = ${MIN_CLAIM_GAS_TGAS};`));
  });

  it("an agent key's method list names no pool or token method", () => {
    const lib = readFileSync(repo("contracts/vault/src/lib.rs"), "utf8");
    const list = /AGENT_METHODS: &\[&str\] = &\[([^\]]*)\]/.exec(lib)?.[1] ?? "";
    expect(list).toContain("spend");
    for (const m of ["buy_coverage", "claim", "ft_transfer_call", "deposit", "withdraw"]) expect(list).not.toContain(m);
  });

  it("buy_coverage appears nowhere in the SDK or MCP sources but the owner client", () => {
    const out = execFileSync("grep", ["-rlE", "buy_coverage|\"claim\"", repo("packages/sdk/src"), repo("packages/mcp/src")], { encoding: "utf8" }).split("\n").filter(Boolean);
    const rel = out.map((f) => f.replace(repo(""), ""));
    expect(rel.filter((f) => !f.includes("generated/") && !f.endsWith("coverage/owner.ts"))).toEqual([]);
  });
});
