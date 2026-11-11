import { describe, expect, it, vi } from "vitest";
import {
  buildCeiling,
  classifiedTarget,
  classifiedTargets,
  createVaultArgs,
  FACTORY,
  FUNDED_YOCTO,
  nextStep,
  planFunds,
  readFactory,
  riskiest,
  setupChecklist,
  vaultIdOf,
  vaultNameError,
  vaultTaken,
  type TargetOption,
} from "./factory";
import type { ChainReads } from "../wallet-transport";

const NEAR = 10n ** 24n;
const opt = (target: string, cls: TargetOption["class"], frozen = false): TargetOption => ({ target, class: cls, frozen, classifiedAtBlock: 1 });

const reads = (views: Record<string, unknown>): ChainReads => ({
  view: (async (contract: string, method: string, args: Record<string, unknown>) => {
    const key = `${contract}.${method}.${JSON.stringify(args)}`;
    if (!(key in views)) throw new Error(`unexpected view ${key}`);
    return views[key];
  }) as ChainReads["view"],
  account: async () => ({ amount: "0", globalContractHash: null }),
});

describe("vault names", () => {
  it("accepts a plain label and builds the account under the factory", () => {
    expect(vaultNameError("my-vault_1")).toBeNull();
    expect(vaultIdOf("abc")).toBe(`abc.${FACTORY}`);
  });
  it("rejects empty, dotted, uppercase and badly separated names before any prompt", () => {
    for (const bad of ["", "a.b", "Abc", "-a", "a--b", "a b"]) expect(vaultNameError(bad)).not.toBeNull();
  });
  it("rejects a name that makes the full account too long", () => {
    expect(vaultNameError("a".repeat(60))).toMatch(/too long/);
  });
  it("catches a name that is already taken, and lets a free one through", async () => {
    const taken = await vaultTaken({ balance: async () => 5n }, "abc");
    const free = await vaultTaken({ balance: async () => null }, "abc");
    expect([taken, free]).toEqual([true, false]);
  });
});

describe("funds (AE4)", () => {
  const base = { depositYocto: NEAR / 2n, minDepositYocto: NEAR / 2n };
  it("is ok when the balance covers the deposit and the gas reserve", () => {
    expect(planFunds({ ...base, balanceYocto: 40n * NEAR }).ok).toBe(true);
  });
  it("reports the shortfall and is not ok when the balance is short, so no transaction is built", () => {
    const p = planFunds({ ...base, balanceYocto: NEAR / 4n });
    expect(p.ok).toBe(false);
    expect(p.shortfallYocto).toBe(p.neededYocto - NEAR / 4n);
    expect(p.shortfallYocto).toBeGreaterThan(0n);
  });
  it("is not ok when the deposit is under the factory minimum, whatever the balance", () => {
    const p = planFunds({ balanceYocto: 40n * NEAR, depositYocto: NEAR / 4n, minDepositYocto: NEAR / 2n });
    expect(p).toMatchObject({ ok: false, depositTooSmall: true, shortfallYocto: 0n });
  });
});

describe("registry classes", () => {
  const rec = (cls: string, frozen = false) => ({ class: cls, frozen, classified_at_block: 7, evidence_hash: "x" });
  it("reads the factory's own registry and minimum deposit", async () => {
    const r = reads({ [`${FACTORY}.get_config.{}`]: { registry: "registry2.arunafi.testnet", min_deposit: "500000000000000000000000", vault_code_hash: "H" } });
    expect(await readFactory(r)).toEqual({ registry: "registry2.arunafi.testnet", minDepositYocto: NEAR / 2n, vaultCodeHash: "H" });
  });
  it("offers a target the registry classified, with its class and frozen state", async () => {
    const r = reads({ 'reg.get_class.{"target":"a.testnet"}': rec("local_upgradeable", true) });
    expect(await classifiedTarget(r, "reg", "a.testnet")).toEqual({ target: "a.testnet", class: "local_upgradeable", frozen: true, classifiedAtBlock: 7 });
  });
  it("omits a target with no registry class, and one the registry labels with an unknown class name", async () => {
    const r = reads({ 'reg.get_class.{"target":"a.testnet"}': null, 'reg.get_class.{"target":"b.testnet"}': rec("made_up") });
    expect(await classifiedTarget(r, "reg", "a.testnet")).toBeNull();
    expect(await classifiedTarget(r, "reg", "b.testnet")).toBeNull();
  });
  it("omits an invalid account id without asking the registry", async () => {
    const view = vi.fn();
    expect(await classifiedTarget({ view, account: async () => ({ amount: "0", globalContractHash: null }) }, "reg", "Not Valid")).toBeNull();
    expect(view).not.toHaveBeenCalled();
  });
  it("drops only the candidate whose read fails", async () => {
    const r = reads({ 'reg.get_class.{"target":"ok.testnet"}': rec("immutable_verified") });
    const found = await classifiedTargets(r, "reg", ["ok.testnet", "boom.testnet"]);
    expect(found.map((t) => t.target)).toEqual(["ok.testnet"]);
  });
});

describe("ceiling", () => {
  it("admits exactly the riskiest class the owner picked", () => {
    expect(riskiest([opt("a", "immutable_verified"), opt("b", "global_by_account")])).toBe("global_by_account");
    expect(buildCeiling([opt("a.testnet", "local_upgradeable")]).max_risk_class).toBe("local_upgradeable");
  });
  it("refuses an empty pick instead of building a ceiling nobody can use", () => {
    expect(() => buildCeiling([])).toThrow(/at least one/);
  });
  it("is NEAR only, in the shape the factory accepted for demo4", () => {
    const c = buildCeiling([opt("a.testnet", "local_upgradeable")]);
    expect(c).toEqual({
      tokens: [{ token: "near", max_per_tx: "500000000000000000000000", daily_total: "2000000000000000000000000" }],
      max_risk_class: "local_upgradeable",
      allowed_targets: ["a.testnet"],
      agent_allowance: "1000000000000000000000000",
    });
    expect(createVaultArgs({ name: "n", owner: "o.testnet", operator: null, ceiling: c })).toMatchObject({ name: "n", operator: null });
  });
});

describe("setup checklist", () => {
  it("opens a created but unfunded vault at the funding step", () => {
    const items = setupChecklist({ exists: true, ceilingTargets: 1, balanceYocto: NEAR / 2n, agents: 0 });
    expect(items.map((i) => i.done)).toEqual([true, true, false, false]);
    expect(nextStep(items)?.id).toBe("funded");
  });
  it("is finished with a ceiling, enough balance and an agent", () => {
    const items = setupChecklist({ exists: true, ceilingTargets: 1, balanceYocto: FUNDED_YOCTO, agents: 1 });
    expect(nextStep(items)).toBeNull();
  });
  it("shows nothing done for a vault that does not exist", () => {
    expect(setupChecklist({ exists: false, ceilingTargets: 0, balanceYocto: null, agents: 0 }).every((i) => !i.done)).toBe(true);
  });
});
