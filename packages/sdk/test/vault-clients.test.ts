import { describe, expect, it } from "vitest";
import { AgentVault, ArunaAuthError, KNOWN_VAULT_VERSIONS, OperatorVault, OwnerVault, VaultVersionError, type VaultTransport } from "../src/vault/index.js";

const hashOf = (v: string) => Object.entries(KNOWN_VAULT_VERSIONS).find(([, n]) => n === v)![0];

/** A fake chain: records every call and answers spend from a script. */
function fake(version: string | null, spendAnswers: unknown[] = [], views: Record<string, unknown> = {}) {
  const calls: { method: string; args: Record<string, unknown>; depositYocto: bigint; tgas: bigint }[] = [];
  const t: VaultTransport & { publicKey(): Promise<string> } = {
    signerId: "v.factory.testnet",
    async publicKey() {
      return "ed25519:AGENT";
    },
    async view<T>(_c: string, method: string) {
      if (!(method in views)) throw new ArunaAuthError(`no view ${method}`);
      return views[method] as T;
    },
    async call(_c, method, args, opts) {
      calls.push({ method, args, ...opts });
      if (method === "spend") return { value: spendAnswers.shift() ?? null, tx: `tx${calls.length}` };
      return { value: null, tx: `tx${calls.length}` };
    },
    async account() {
      return { amount: "5", globalContractHash: version ? hashOf(version) : "UNKNOWN" };
    },
  };
  return { t, calls };
}
const swap = { adapter: "swap" as const, target: "t.testnet", amount: "10", minAmountOut: "10" };

describe("vault clients", () => {
  it("refuses a vault on a code hash it does not know, loudly", async () => {
    const { t } = fake(null);
    await expect(new AgentVault({ vaultId: "v", transport: t }).spend(swap)).rejects.toThrow(VaultVersionError);
  });

  it("a settled spend resolves ok", async () => {
    const { t } = fake("v3", [true]);
    expect(await new AgentVault({ vaultId: "v", transport: t }).spend(swap)).toEqual({ ok: true, settled: true, tx: "tx1" });
  });

  it("a refusal resolves with the SDK reason code, not a throw", async () => {
    const { t } = fake("v3", [{ outcome: "Blocked", reason: "ARUNA_DAILY_CAP_EXCEEDED", class: "local_upgradeable" }]);
    const r = await new AgentVault({ vaultId: "v", transport: t }).spend(swap);
    expect(r).toEqual({ ok: false, reason: "DAILY_CAP_EXCEEDED", targetClass: "local_upgradeable", tx: "tx1" });
  });

  it("a stale class is refreshed and the spend retried exactly once", async () => {
    const stale = { outcome: "Blocked", reason: "ARUNA_CLASS_STALE", class: null };
    const { t, calls } = fake("v3", [stale, stale]);
    const r = await new AgentVault({ vaultId: "v", transport: t }).spend(swap);
    expect(r.ok).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(["spend", "refresh_class", "spend"]);
  });

  it("autoRefresh: false shows the stale refusal as is", async () => {
    const { t, calls } = fake("v3", [{ outcome: "Blocked", reason: "ARUNA_CLASS_STALE", class: null }]);
    const r = await new AgentVault({ vaultId: "v", transport: t, autoRefresh: false }).spend(swap);
    expect(r).toMatchObject({ ok: false, reason: "CLASS_STALE" });
    expect(calls.map((c) => c.method)).toEqual(["spend"]);
  });

  it("no other refusal is retried", async () => {
    const { t, calls } = fake("v3", [{ outcome: "Blocked", reason: "ARUNA_TARGET_NOT_ALLOWED", class: null }]);
    await new AgentVault({ vaultId: "v", transport: t }).spend(swap);
    expect(calls.length).toBe(1);
  });

  it("a token spend needs v3, and a v2 spend sends no token argument", async () => {
    const ft = { ...swap, adapter: "ft_swap" as const, token: "usdc.testnet" };
    await expect(new AgentVault({ vaultId: "v", transport: fake("v2").t }).spend(ft)).rejects.toThrow(/v3/);
    const { t, calls } = fake("v2", [true]);
    await new AgentVault({ vaultId: "v", transport: t }).spend(swap);
    expect("token" in calls[0].args).toBe(false);
    const v3 = fake("v3", [true]);
    await new AgentVault({ vaultId: "v", transport: v3.t }).spend(ft);
    expect(v3.calls[0]).toMatchObject({ args: { token: "usdc.testnet" }, tgas: 150n });
  });

  it("simulate needs v4, and maps the verdict", async () => {
    await expect(new AgentVault({ vaultId: "v", transport: fake("v3").t }).simulate(swap)).rejects.toThrow(VaultVersionError);
    const { t } = fake("v4", [], { simulate: { verdict: "block", reason: "ARUNA_SLIPPAGE_TOO_HIGH", class: "local_upgradeable" } });
    expect(await new AgentVault({ vaultId: "v", transport: t }).simulate(swap)).toEqual({ verdict: "block", reason: "SLIPPAGE_TOO_HIGH", targetClass: "local_upgradeable" });
  });

  it("power-granting operator and owner calls attach 1 yoctoNEAR; pause and revoke attach none", async () => {
    const { t, calls } = fake("v4");
    const op = new OperatorVault({ vaultId: "v", transport: t });
    await op.createAgent({ publicKey: "ed25519:K", label: "a", policy: { limits: [{ token: "usdc.testnet", maxPerTx: "1", dailyCap: "2" }], maxSlippageBps: 50, allowedTargets: ["t.testnet"], maxRiskClass: "local_upgradeable" } });
    await op.pauseAgent("ed25519:K");
    await new OwnerVault({ vaultId: "v", transport: t }).withdrawToOwner("7", "usdc.testnet");
    expect(calls.map((c) => [c.method, c.depositYocto])).toEqual([["add_agent", 1n], ["pause_agent", 0n], ["withdraw_to_owner", 1n]]);
    expect(calls[0].args.policy).toEqual({ limits: [{ token: { ft: "usdc.testnet" }, max_per_tx: "1", daily_cap: "2" }], max_slippage_bps: 50, allowed_targets: ["t.testnet"], max_risk_class: "local_upgradeable" });
    expect(calls[2].args).toEqual({ amount: "7", token: { ft: "usdc.testnet" } });
  });

  it("the agent's client has no operator or owner methods", () => {
    const a = new AgentVault({ vaultId: "v", transport: fake("v4").t }) as unknown as Record<string, unknown>;
    for (const m of ["createAgent", "tightenPolicy", "revokeAgent", "withdrawToOwner", "setOperator", "resumeAgent", "setCeiling"]) expect(a[m]).toBeUndefined();
  });
});
