import { describe, expect, it } from "vitest";
import { relationOf } from "./walletRole";

const vault = { owner: "alice.testnet", operator: "ops.testnet" };

describe("relationOf", () => {
  it("is null with no wallet", () => expect(relationOf(null, vault)).toBeNull());
  it("recognises the owner and the operator", () => {
    expect(relationOf("alice.testnet", vault)).toBe("owner");
    expect(relationOf("ops.testnet", vault)).toBe("operator");
  });
  it("treats anyone else as none", () => expect(relationOf("bob.testnet", vault)).toBe("none"));
  it("does not match a missing operator", () => expect(relationOf("ops.testnet", { owner: "a.testnet", operator: null })).toBe("none"));
  it("prefers owner when one account holds both", () => expect(relationOf("a.testnet", { owner: "a.testnet", operator: "a.testnet" })).toBe("owner"));
});
