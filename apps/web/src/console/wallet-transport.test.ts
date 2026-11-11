import { ArunaAuthError, ArunaRpcError, OwnerVault } from "@aruna/sdk/vault";
import { describe, expect, it, vi } from "vitest";
import { createWalletTransport, toCallResult, type CallPreview, type WalletLike } from "./wallet-transport";
import { WalletCancelledError } from "./tx-status";

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const reads = { view: async () => ({}) as never, account: async () => ({ amount: "0", globalContractHash: null }) };

const outcome = (over: Record<string, unknown> = {}) => ({
  status: { SuccessValue: b64({ ok: 1 }) },
  transaction: { hash: "TXHASH" },
  receipts_outcome: [
    { outcome: { executor_id: "vault.testnet", logs: ["a"] } },
    { outcome: { executor_id: "registry.testnet", logs: ["EVENT_JSON:b", "c"] } },
  ],
  ...over,
});

const wallet = (impl: WalletLike["signAndSendTransaction"]): WalletLike => ({ signAndSendTransaction: impl });
const make = (w: WalletLike, extra: Record<string, unknown> = {}) => createWalletTransport({ wallet: w, signerId: "owner.testnet", ...reads, ...extra });

describe("toCallResult", () => {
  it("keeps the receipts of two executors apart and flattens the logs in order", () => {
    const r = toCallResult(outcome());
    expect(r.tx).toBe("TXHASH");
    expect(r.value).toEqual({ ok: 1 });
    expect(r.receipts).toEqual([
      { executor: "vault.testnet", logs: ["a"] },
      { executor: "registry.testnet", logs: ["EVENT_JSON:b", "c"] },
    ]);
    expect(r.logs).toEqual(["a", "EVENT_JSON:b", "c"]);
  });

  it("returns null for an empty return value", () => {
    expect(toCallResult(outcome({ status: { SuccessValue: "" } })).value).toBeNull();
  });

  it("turns a Failure status into an authorization failure", () => {
    expect(() => toCallResult(outcome({ status: { Failure: { ActionError: "x" } } }))).toThrow(ArunaAuthError);
  });

  it("refuses a result with no transaction hash instead of trusting it", () => {
    expect(() => toCallResult(outcome({ transaction: {} }))).toThrow(ArunaRpcError);
  });
});

describe("createWalletTransport", () => {
  it("throws before any wallet prompt for a network that is not testnet", () => {
    const sign = vi.fn();
    expect(() => createWalletTransport({ wallet: wallet(sign), signerId: "o.near", network: "mainnet", ...reads })).toThrow(/testnet only/);
    expect(sign).not.toHaveBeenCalled();
  });

  it("sends one function-call action with the deposit and gas the SDK asked for", async () => {
    const sign = vi.fn(async () => outcome());
    const t = make(wallet(sign));
    await t.call("vault.testnet", "withdraw_to_owner", { amount: "5" }, { depositYocto: 1n, tgas: 30n });
    expect(sign).toHaveBeenCalledWith({
      receiverId: "vault.testnet",
      actions: [{ type: "FunctionCall", params: { methodName: "withdraw_to_owner", args: { amount: "5" }, gas: "30000000000000", deposit: "1" } }],
    });
  });

  it("previews withdraw_to_owner with 1 yoctoNEAR and the vault as receiver, before the wallet opens", async () => {
    const order: string[] = [];
    let seen: CallPreview | undefined;
    const sign = vi.fn(async () => (order.push("wallet"), outcome()));
    const t = make(wallet(sign), {
      confirm: async (p: CallPreview) => ((seen = p), order.push("preview"), true),
    });
    await new OwnerVault({ vaultId: "vault.testnet", transport: t }).withdrawToOwner("5");
    expect(order).toEqual(["preview", "wallet"]);
    expect(seen).toMatchObject({ receiver: "vault.testnet", method: "withdraw_to_owner", depositYocto: "1", signer: "owner.testnet" });
  });

  it("sends nothing when the preview is declined, and reports a cancel", async () => {
    const sign = vi.fn();
    const t = make(wallet(sign), { confirm: () => false });
    await expect(t.call("v.testnet", "pause_agent", {}, { depositYocto: 0n, tgas: 30n })).rejects.toBeInstanceOf(WalletCancelledError);
    expect(sign).not.toHaveBeenCalled();
  });

  it("maps a closed wallet prompt to a cancel, not an error", async () => {
    const t = make(wallet(async () => Promise.reject(new Error("User closed the window"))));
    await expect(t.call("v.testnet", "pause_agent", {}, { depositYocto: 0n, tgas: 30n })).rejects.toBeInstanceOf(WalletCancelledError);
  });

  it("maps a contract panic to an authorization failure and any other failure to a send failure", async () => {
    const panic = make(wallet(async () => Promise.reject(new Error("Smart contract panicked: ARUNA_NOT_OWNER"))));
    await expect(panic.call("v.testnet", "x", {}, { depositYocto: 0n, tgas: 30n })).rejects.toBeInstanceOf(ArunaAuthError);
    const net = make(wallet(async () => Promise.reject(new Error("fetch failed"))));
    await expect(net.call("v.testnet", "x", {}, { depositYocto: 0n, tgas: 30n })).rejects.toBeInstanceOf(ArunaRpcError);
  });
});

describe("sendNear", () => {
  it("sends one Transfer action and previews the amount first", async () => {
    const { sendNear } = await import("./wallet-transport");
    const order: string[] = [];
    const sign = vi.fn(async () => (order.push("wallet"), outcome()));
    const r = await sendNear({
      wallet: wallet(sign),
      signerId: "owner.testnet",
      receiver: "vault.testnet",
      depositYocto: 10n ** 24n,
      confirm: (p) => (order.push(`preview ${p.method} ${p.depositYocto}`), true),
    });
    expect(order).toEqual([`preview transfer ${10n ** 24n}`, "wallet"]);
    expect(sign).toHaveBeenCalledWith({ receiverId: "vault.testnet", actions: [{ type: "Transfer", params: { deposit: (10n ** 24n).toString() } }] });
    expect(r.tx).toBe("TXHASH");
  });
  it("sends nothing for a declined preview, a zero amount or another network", async () => {
    const { sendNear } = await import("./wallet-transport");
    const sign = vi.fn();
    const base = { wallet: wallet(sign), signerId: "o.testnet", receiver: "v.testnet", depositYocto: 1n };
    await expect(sendNear({ ...base, confirm: () => false })).rejects.toBeInstanceOf(WalletCancelledError);
    await expect(sendNear({ ...base, depositYocto: 0n })).rejects.toThrow(/above zero/);
    await expect(sendNear({ ...base, network: "mainnet" })).rejects.toThrow(/testnet only/);
    expect(sign).not.toHaveBeenCalled();
  });
});
