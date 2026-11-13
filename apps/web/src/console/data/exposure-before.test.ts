import { describe, expect, it } from "vitest";
import { exposureCall, exposureCommand, type ExposureForm } from "./exposure-before";

const form = (o: Partial<ExposureForm> = {}): ExposureForm => ({ agent: "ed25519:A", target: "drift-target.arunafi.testnet", token: "near", block: "277193145", ...o });

describe("exposure before a block", () => {
  it("turns the form into the vault's view arguments", () => {
    expect(exposureCall(form())).toEqual({ args: { agent: "ed25519:A", target: "drift-target.arunafi.testnet", token: "near", block: 277193145 } });
    expect(exposureCall(form({ token: "NEAR" }))).toMatchObject({ args: { token: "near" } });
    expect(exposureCall(form({ token: "usdc.arunafi.testnet" }))).toMatchObject({ args: { token: { ft: "usdc.arunafi.testnet" } } });
  });
  it("names the field that is wrong instead of defaulting it", () => {
    expect(exposureCall(form({ agent: "" }))).toEqual({ problem: "Choose an agent." });
    expect(exposureCall(form({ target: "Not A Target" }))).toHaveProperty("problem", expect.stringContaining("target"));
    expect(exposureCall(form({ token: "bad token!" }))).toHaveProperty("problem", expect.stringContaining("token"));
    for (const block of ["", "0", "-5", "1.5", "abc", "99999999999999999999"]) expect(exposureCall(form({ block }))).toHaveProperty("problem", expect.stringContaining("block"));
  });
  it("prints the command that asks the vault the same thing", () => {
    const c = exposureCall(form());
    if ("problem" in c) throw new Error("expected a call");
    expect(exposureCommand("v.factory2.arunafi.testnet", c.args)).toBe(
      `node fixtures/tools.mjs view v.factory2.arunafi.testnet exposure_before '{"agent":"ed25519:A","target":"drift-target.arunafi.testnet","token":"near","block":277193145}'`,
    );
  });
});
