import { ArunaAuthError, ArunaRpcError } from "@aruna/sdk/vault";
import { describe, expect, it } from "vitest";
import { explorerTxUrl, phaseOf, phaseOfError, reasonIn, runTx, WalletCancelledError, type TxPhase } from "./tx-status";

describe("phaseOf", () => {
  it("shows a policy refusal as an outcome with its reason and class, not a failure", () => {
    expect(phaseOf({ ok: false, reason: "TARGET_NOT_ALLOWED", targetClass: "local_upgradeable", tx: "H" })).toEqual({
      kind: "refused",
      reason: "TARGET_NOT_ALLOWED",
      targetClass: "local_upgradeable",
      hash: "H",
    });
  });
  it("shows a refusal the SDK returned without a transaction as refused with no hash", () => {
    expect(phaseOf({ ok: false, reason: "CAPITAL_LOCKED", tx: null })).toEqual({ kind: "refused", reason: "CAPITAL_LOCKED", targetClass: null, hash: null });
  });
  it("confirms a result with a hash, and one without", () => {
    expect(phaseOf({ ok: true, settled: true, tx: "H" })).toEqual({ kind: "confirmed", hash: "H" });
    expect(phaseOf(undefined)).toEqual({ kind: "confirmed", hash: null });
  });
});

describe("phaseOfError", () => {
  it("treats a cancel as a cancel", () => expect(phaseOfError(new WalletCancelledError())).toEqual({ kind: "cancelled" }));
  it("keeps the ARUNA_ code of an authorization failure", () => {
    expect(phaseOfError(new ArunaAuthError("Smart contract panicked: ARUNA_NOT_OWNER"))).toMatchObject({ kind: "failed", reason: "ARUNA_NOT_OWNER", sent: true });
  });
  it("says a send failure may or may not have run", () => {
    expect(phaseOfError(new ArunaRpcError("timeout"))).toMatchObject({ kind: "failed", sent: false });
  });
});

describe("runTx", () => {
  it("goes signing then confirmed for a mock action that returns nothing", async () => {
    const seen: string[] = [];
    await runTx(() => undefined, (p) => seen.push(p.kind));
    expect(seen).toEqual(["signing", "confirmed"]);
  });
  it("goes signing then failed when the action throws, and never leaves signing set", async () => {
    const seen: TxPhase[] = [];
    const end = await runTx(() => Promise.reject(new Error("boom")), (p) => seen.push(p));
    expect(seen.map((p) => p.kind)).toEqual(["signing", "failed"]);
    expect(end.kind).toBe("failed");
  });
});

describe("helpers", () => {
  it("finds an ARUNA code in a message and returns null when there is none", () => {
    expect(reasonIn("panicked at ARUNA_CLASS_STALE here")).toBe("ARUNA_CLASS_STALE");
    expect(reasonIn("network down")).toBeNull();
  });
  it("builds a testnet explorer link from the hash only", () => {
    expect(explorerTxUrl("ABC")).toBe("https://testnet.nearblocks.io/txns/ABC");
  });
});
