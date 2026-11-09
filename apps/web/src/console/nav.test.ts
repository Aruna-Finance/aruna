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

  it("uses no em dash", () => {
    expect(JSON.stringify({ ROLES, SCREENS })).not.toContain("\u2014");
  });
});
