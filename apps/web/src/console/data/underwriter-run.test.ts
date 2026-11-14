import { ArunaAuthError, type CallResult, type VaultTransport } from "@aruna/sdk/vault";
import { describe, expect, it } from "vitest";
import { POOL, USDC } from "./price";
import { performDeposit, performWithdraw } from "./underwriter-run";

const ME = "me.testnet";
const ev = (event: string, data: unknown) => `EVENT_JSON:${JSON.stringify({ standard: "aruna", version: "1.0.0", event, data: [data] })}`;

function transport(result: Partial<CallResult> | Error) {
  const calls: { contract: string; method: string; args: Record<string, unknown>; deposit: bigint }[] = [];
  const t: VaultTransport = {
    signerId: ME,
    view: async <T,>() => ({ total: "1", available: "0" }) as T,
    account: async () => ({ amount: "0", globalContractHash: null }),
    async call(contract, method, args, o) {
      calls.push({ contract, method, args, deposit: o.depositYocto });
      if (result instanceof Error) throw result;
      return { value: null, tx: "TX", ...result };
    },
  };
  return { t, calls };
}

describe("performDeposit", () => {
  it("a credited deposit refreshes the screen once and returns the result for the dialog", async () => {
    const { t, calls } = transport({ logs: [ev("capital_deposited", { underwriter: ME, token: "near", amount: "5", shares: "5" })] });
    let done = 0;
    const r = await performDeposit({ transport: t, token: "near", amount: 5n, onDone: () => done++ });
    expect(r).toMatchObject({ ok: true, amount: "5" });
    expect(done).toBe(1);
    expect(calls[0]).toMatchObject({ contract: POOL, method: "deposit", deposit: 5n });
  });
  it("a refused deposit does not refresh the screen and is returned as a refusal", async () => {
    const { t } = transport({ value: "0", receipts: [] });
    let done = 0;
    const r = await performDeposit({ transport: t, token: USDC, amount: 1n, onDone: () => done++ });
    expect(r).toEqual({ ok: false, reason: "DEPOSIT_REFUNDED", tx: "TX" });
    expect(done).toBe(0);
  });
});

describe("performWithdraw", () => {
  const paid = ev("capital_withdrawn", { underwriter: ME, token: "near", amount: "9" });
  it("everything sends the shares read just before signing", async () => {
    const { t, calls } = transport({ logs: [paid] });
    let done = 0;
    const r = await performWithdraw({ transport: t, token: "near", plan: { all: true }, readHeld: async () => 480n, onDone: () => done++ });
    expect(r).toMatchObject({ ok: true, amount: "9" });
    expect(calls[0]).toMatchObject({ contract: POOL, method: "withdraw", args: { token: "near", shares: "480" }, deposit: 1n });
    expect(done).toBe(1);
  });
  it("covers AE5: a withdrawal the pool refuses as locked comes back as a refusal, with no refresh", async () => {
    const { t } = transport(new ArunaAuthError("Smart contract panicked: ARUNA_CAPITAL_LOCKED"));
    let done = 0;
    const r = await performWithdraw({ transport: t, token: "near", plan: { shares: 7n }, readHeld: async () => 0n, onDone: () => done++ });
    expect(r).toEqual({ ok: false, reason: "CAPITAL_LOCKED", tx: null });
    expect(done).toBe(0);
  });
});
