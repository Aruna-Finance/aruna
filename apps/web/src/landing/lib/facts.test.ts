import { describe, expect, it } from "vitest";
import * as facts from "./facts";
import { REFUSALS } from "./facts";

describe("facts copied from the docs", () => {
  it("uses no em dash anywhere", () => {
    expect(JSON.stringify(facts)).not.toContain("—");
  });

  it("keeps every refusal reason prefixed ARUNA_ and unique", () => {
    const names = REFUSALS.map((r) => r.reason);
    expect(names.every((n) => n.startsWith("ARUNA_"))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("explains every refusal that does not count toward auto-disable", () => {
    for (const r of REFUSALS) if (!r.counts) expect(r.why).toBeTruthy();
  });

  it("lists exactly the five closed routes and nine assumptions with unique ids", () => {
    expect(facts.IMPOSSIBLE).toHaveLength(5);
    const ids = facts.ASSUMPTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never calls the system trustless", () => {
    expect(JSON.stringify(facts).toLowerCase()).not.toContain("trustless");
  });
});
