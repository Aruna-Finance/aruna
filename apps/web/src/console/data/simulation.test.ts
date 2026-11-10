import { describe, expect, it } from "vitest";
import { SCENARIOS, simulate, simulateMany, type ScenarioId } from "./simulation";

describe("pool simulation (prototype model)", () => {
  it("draws the same run for the same seed", () => {
    expect(simulate("correlated", 42)).toEqual(simulate("correlated", 42));
  });

  it("runs 60 days", () => {
    expect(simulate("normal", 42).series).toHaveLength(60);
  });

  it("holds under normal operation with the pool rules on", () => {
    expect(simulateMany("normal", 50).pInsolvent).toBe(0);
  });

  it("breaks when the pool is thin and the rules are off", () => {
    const r = simulate("undercapitalized", 42);
    expect(r.unpaid).toBeGreaterThan(0);
    expect(r.insolventDay).not.toBeNull();
    expect(simulateMany("undercapitalized", 50).pInsolvent).toBeGreaterThan(0.5);
  });

  it("the rules turn policies away, and a bigger pool turns fewer", () => {
    const base = simulate("correlated", 42);
    const more = simulate("correlated", 42, { capital: 300_000 });
    expect(base.turnedAway).toBeGreaterThan(0);
    expect(more.turnedAway).toBeLessThan(base.turnedAway);
  });

  it("has a note for every scenario", () => {
    for (const id of Object.keys(SCENARIOS) as ScenarioId[]) expect(SCENARIOS[id].note.length).toBeGreaterThan(10);
  });
});
