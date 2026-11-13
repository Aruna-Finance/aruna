import { describe, expect, it } from "vitest";
import { switchHref, switchOptions } from "./vault-switch";

const o = (vault: string) => ({ vault, version: "v4", registeredAtBlock: 1 });

describe("switchOptions", () => {
  it("puts the current vault first and lists each other owned vault once", () => {
    expect(switchOptions("b.f", [o("a.f"), o("b.f"), o("c.f"), o("a.f")]).map((x) => x.value)).toEqual(["b.f", "a.f", "c.f"]);
  });
  it("lists the current vault even when the account does not own it", () => {
    expect(switchOptions("op.f", []).map((x) => x.value)).toEqual(["op.f"]);
  });
});

describe("switchHref", () => {
  it("keeps the screen and sets the vault", () => {
    expect(switchHref("/console/dashboard/", "?vault=a.f", "b.f")).toBe("/console/dashboard/?vault=b.f");
    expect(switchHref("/console/claims", "", "b.f")).toBe("/console/claims/?vault=b.f");
  });
  it("keeps other parameters, such as a report id", () => {
    expect(switchHref("/console/claims/detail/", "?id=2&vault=a.f", "b.f")).toBe("/console/claims/detail/?id=2&vault=b.f");
  });
  it("leaves an agent's page for the new vault's agent list", () => {
    expect(switchHref("/console/agents/detail/", "?agent=ed25519%3AX&vault=a.f", "b.f")).toBe("/console/agents/?vault=b.f");
  });
});
