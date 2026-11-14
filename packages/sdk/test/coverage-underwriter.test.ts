import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POOL_PANIC_REASONS, UNDERWRITER_GAS_TGAS, Underwriter } from "../src/coverage/index.js";
import { ArunaAuthError, ArunaRpcError, type CallResult, type VaultTransport } from "../src/vault/transport.js";

const repo = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
// The format the contracts emit (contracts/common/src/events.rs).
const ev = (event: string, data: unknown) => `EVENT_JSON:${JSON.stringify({ standard: "aruna", version: "1.0.0", event, data: [data] })}`;
const POOL = "pool.testnet";
const ME = "me.testnet";
const USDC = "usdc.testnet";

function transport(result: Partial<CallResult> | Error, storage: unknown = { total: "1", available: "0" }) {
  const calls: { contract: string; method: string; args: Record<string, unknown>; deposit: bigint; tgas: bigint }[] = [];
  const views: { contract: string; method: string; args: Record<string, unknown> }[] = [];
  const t: VaultTransport = {
    signerId: ME,
    async view<T>(contract: string, method: string, args: Record<string, unknown>) {
      views.push({ contract, method, args });
      return storage as T;
    },
    account: async () => ({ amount: "0", globalContractHash: null }),
    async call(contract, method, args, o) {
      calls.push({ contract, method, args, deposit: o.depositYocto, tgas: o.tgas });
      if (result instanceof Error) throw result;
      return { value: null, tx: "TX", ...result };
    },
  };
  return { t, calls, views };
}
const under = (t: VaultTransport) => new Underwriter({ pool: POOL, transport: t });
const deposited = (token: unknown, amount: string, shares: string, who = ME) => ev("capital_deposited", { underwriter: who, token, amount, shares });
const withdrawn = (token: unknown, amount: string, who = ME) => ev("capital_withdrawn", { underwriter: who, token, amount });

describe("Underwriter.deposit", () => {
  it("a NEAR deposit attaches the amount to the pool's deposit and returns the amount and shares the pool logged", async () => {
    const { t, calls } = transport({ logs: [deposited("near", "2000", "1900")] });
    expect(await under(t).deposit({ token: "near", amount: "2000" })).toEqual({ ok: true, amount: "2000", shares: "1900", tx: "TX" });
    expect(calls[0]).toMatchObject({ contract: POOL, method: "deposit", args: {}, deposit: 2000n, tgas: UNDERWRITER_GAS_TGAS.deposit });
  });

  it("a USDC deposit is an ft_transfer_call on the token to the pool, with the deposit message and 1 yocto", async () => {
    const { t, calls } = transport({ value: "500", receipts: [{ executor: POOL, logs: [deposited({ ft: USDC }, "500", "500")] }] });
    expect(await under(t).deposit({ token: USDC, amount: "500" })).toMatchObject({ ok: true, amount: "500", shares: "500" });
    expect(calls[0]).toMatchObject({ contract: USDC, method: "ft_transfer_call", deposit: 1n, tgas: UNDERWRITER_GAS_TGAS.depositFt });
    expect(calls[0]?.args).toMatchObject({ receiver_id: POOL, amount: "500" });
    expect(JSON.parse(String(calls[0]?.args.msg))).toEqual({ action: "deposit" });
  });

  it("covers AE6: a USDC deposit the token refunded (return value 0, no pool event) resolves refused as DEPOSIT_REFUNDED", async () => {
    const { t } = transport({ value: "0", receipts: [{ executor: USDC, logs: [] }] });
    expect(await under(t).deposit({ token: USDC, amount: "1" })).toEqual({ ok: false, reason: "DEPOSIT_REFUNDED", tx: "TX" });
  });

  it.each(["CAPITAL_LOCKED", "NOT_ENOUGH_SHARES", "ZERO_DEPOSIT", "DEPOSIT_TOO_SMALL"])("a pool panic with ARUNA_%s resolves refused and sends no transaction hash", async (code) => {
    const { t } = transport(new ArunaAuthError(`{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: ARUNA_${code}"}}}}`));
    expect(await under(t).deposit({ token: "near", amount: "1" })).toEqual({ ok: false, reason: code, tx: null });
  });

  it("an authorization failure that is not a pool refusal still throws", async () => {
    const { t } = transport(new ArunaAuthError("Smart contract panicked: something else"));
    await expect(under(t).deposit({ token: "near", amount: "1" })).rejects.toBeInstanceOf(ArunaAuthError);
  });

  it("an outcome the logs do not show is never reported as success: empty logs and a non-zero value throw", async () => {
    const { t } = transport({ value: "500", logs: [] });
    await expect(under(t).deposit({ token: USDC, amount: "500" })).rejects.toBeInstanceOf(ArunaRpcError);
  });

  it("a USDC deposit with no return value and no pool receipts throws; a missing value is never read as a refund", async () => {
    const { t } = transport({ value: null, receipts: [] });
    await expect(under(t).deposit({ token: USDC, amount: "500" })).rejects.toBeInstanceOf(ArunaRpcError);
  });

  it("a capital_deposited printed by another contract is not a deposit", async () => {
    const { t } = transport({ value: "500", receipts: [{ executor: "evil-token.testnet", logs: [deposited({ ft: USDC }, "500", "500")] }] });
    await expect(under(t).deposit({ token: USDC, amount: "500" })).rejects.toBeInstanceOf(ArunaRpcError);
  });

  it("a capital_deposited for another account is not this account's deposit", async () => {
    const { t } = transport({ logs: [deposited("near", "2000", "1900", "someone-else.testnet")] });
    await expect(under(t).deposit({ token: "near", amount: "2000" })).rejects.toBeInstanceOf(ArunaRpcError);
  });
});

describe("Underwriter.withdraw", () => {
  it("a NEAR withdrawal sends the token id and the exact share string with 1 yocto and returns the amount the pool logged", async () => {
    const { t, calls, views } = transport({ logs: [withdrawn("near", "2100")] });
    expect(await under(t).withdraw({ token: "near", shares: "1900" })).toEqual({ ok: true, amount: "2100", tx: "TX" });
    expect(calls[0]).toMatchObject({ contract: POOL, method: "withdraw", args: { token: "near", shares: "1900" }, deposit: 1n, tgas: UNDERWRITER_GAS_TGAS.withdraw });
    expect(views).toHaveLength(0);
  });

  it("a USDC withdrawal checks the signer's registration on the token first, then withdraws", async () => {
    const { t, calls, views } = transport({ receipts: [{ executor: POOL, logs: [withdrawn({ ft: USDC }, "498")] }] });
    expect(await under(t).withdraw({ token: USDC, shares: "500" })).toMatchObject({ ok: true, amount: "498" });
    expect(views[0]).toEqual({ contract: USDC, method: "storage_balance_of", args: { account_id: ME } });
    expect(calls[0]).toMatchObject({ contract: POOL, method: "withdraw", args: { token: { ft: USDC }, shares: "500" } });
  });

  it("an unregistered USDC holder resolves refused as PAYOUT_NOT_REGISTERED and nothing is sent", async () => {
    const { t, calls } = transport({}, null);
    expect(await under(t).withdraw({ token: USDC, shares: "500" })).toEqual({ ok: false, reason: "PAYOUT_NOT_REGISTERED", tx: null });
    expect(calls).toHaveLength(0);
  });

  it("covers AE5: a withdrawal while the book is locked resolves refused as CAPITAL_LOCKED", async () => {
    const { t } = transport(new ArunaAuthError("Smart contract panicked: ARUNA_CAPITAL_LOCKED"));
    expect(await under(t).withdraw({ token: "near", shares: "1" })).toEqual({ ok: false, reason: "CAPITAL_LOCKED", tx: null });
  });

  it("withdrawing more shares than held resolves refused as NOT_ENOUGH_SHARES", async () => {
    const { t } = transport(new ArunaAuthError("Smart contract panicked: ARUNA_NOT_ENOUGH_SHARES"));
    expect(await under(t).withdraw({ token: "near", shares: "9" })).toMatchObject({ ok: false, reason: "NOT_ENOUGH_SHARES" });
  });

  it("a transaction that shows no capital_withdrawn throws", async () => {
    const { t } = transport({ logs: [] });
    await expect(under(t).withdraw({ token: "near", shares: "1" })).rejects.toBeInstanceOf(ArunaRpcError);
  });
});

describe("what ties the client to the contract, and keeps it away from agents", () => {
  it("every pool panic code the client maps is a code the pool contract panics with", () => {
    const lib = readFileSync(repo("contracts/pool/src/lib.rs"), "utf8");
    for (const code of POOL_PANIC_REASONS) expect(lib).toContain(`ARUNA_${code}`);
  });

  it("the pool's deposit and withdraw calls are made nowhere in the SDK or MCP sources but the underwriter client", () => {
    const shape = 'call\\(this\\.o\\.pool, "(deposit|withdraw)"|"action": ?"deposit"|action: "deposit"';
    const out = execFileSync("grep", ["-rlE", shape, repo("packages/sdk/src"), repo("packages/mcp/src")], { encoding: "utf8" }).split("\n").filter(Boolean);
    const rel = out.map((f) => f.replace(repo(""), ""));
    expect(rel.filter((f) => !f.includes("generated/") && !f.endsWith("coverage/underwriter.ts"))).toEqual([]);
    expect(rel.some((f) => f.endsWith("coverage/underwriter.ts"))).toBe(true);
  });
});
