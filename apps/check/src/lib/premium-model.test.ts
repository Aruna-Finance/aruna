import { describe, expect, it } from "vitest";
import { premium } from "./premium-model";

describe("mock premium model", () => {
  it("never prices unknown", () => {
    expect(premium("unknown", 100, 0.5).priced).toBe(false);
  });

  it("a tighter policy costs less to cover", () => {
    const at = (cap: number, slip: number) => {
      const r = premium("local_upgradeable", cap, slip);
      return r.priced ? r.total : NaN;
    };
    expect(at(50, 0.5)).toBeLessThan(at(100, 0.5));
    expect(at(100, 0.2)).toBeLessThan(at(100, 2));
  });

  it("orders classes by price at the same policy", () => {
    const t = (c: "immutable_verified" | "local_upgradeable" | "global_by_account") => {
      const r = premium(c, 100, 0.5);
      return r.priced ? r.total : NaN;
    };
    expect(t("immutable_verified")).toBeLessThan(t("local_upgradeable"));
    expect(t("local_upgradeable")).toBeLessThan(t("global_by_account"));
  });

  it("reports maximum 30-day exposure", () => {
    expect(premium("local_upgradeable", 100, 0.5).maxExposure).toBe(3000);
  });
});
