import { describe, expect, it } from "vitest";
import { ROLES, SCREENS, SCREEN_IDS, roleById, roleFor } from "./nav";

describe("console navigation", () => {
  it("has a screen entry for every sidebar item", () => {
    for (const r of ROLES) for (const i of r.items) expect(SCREENS[i.id]).toBeDefined();
  });

  it("puts every role's home in its own sidebar", () => {
    for (const r of ROLES) expect(r.items.some((i) => i.id === r.home)).toBe(true);
  });

  it("gives every screen a role that can see it", () => {
    for (const id of SCREEN_IDS) {
      expect(roleById(SCREENS[id].role).items.some((i) => i.id === id)).toBe(true);
    }
  });

  it("keeps the operator on shared screens and switches role otherwise", () => {
    expect(roleFor("dashboard", "operator")).toBe("operator");
    expect(roleFor("migrate", "operator")).toBe("owner");
    expect(roleFor("pool", "owner")).toBe("underwriter");
  });

  it("offers three roles in the picker, and the public pages are global and keep the current role", () => {
    expect(ROLES.map((r) => r.label)).toEqual(["Client", "Operator", "Underwriter"]);
    for (const page of ["developers", "targets", "claims", "lookup", "attestor"] as const)
      for (const r of ROLES) expect(roleFor(page, r.id)).toBe(r.id);
  });

  it("shows no demo, migration or create entry in any sidebar", () => {
    for (const r of ROLES) {
      const shown = r.items.filter((i) => !i.hidden).map((i) => i.id);
      expect(shown).not.toContain("story");
      expect(shown).not.toContain("developers");
      for (const page of ["targets", "claims", "lookup"]) expect(shown).not.toContain(page);
      expect(shown).not.toContain("migrate");
      expect(shown).not.toContain("create");
    }
  });

  it("gives the client one Vault screen after Overview, and the operator none", () => {
    expect(roleById("owner").items.slice(0, 3).map((i) => i.id)).toEqual(["dashboard", "vault", "agents"]);
    expect(roleById("operator").items.some((i) => i.id === "vault")).toBe(false);
  });

  it("uses no em dash", () => {
    expect(JSON.stringify({ ROLES, SCREENS })).not.toContain("\u2014");
  });
});
