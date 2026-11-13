import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MEASURES, SIM, probabilityText, timeToInsolvencyText } from "./simulation-published";

const dir = join(process.cwd(), "../..", SIM.generatedFrom);
const has = existsSync(join(dir, "summary.json"));

describe("published simulation data", () => {
  it("has the six measures and exactly one scenario that breaks the pool", () => {
    expect(MEASURES).toHaveLength(6);
    expect(SIM.scenarios.filter((s) => s.breaksThePool)).toHaveLength(1);
  });

  it("says a solvent scenario was not insolvent within the run, never 'never'", () => {
    const solvent = SIM.scenarios.find((s) => s.timeToInsolvencyDays.insolventRuns === 0)!;
    expect(timeToInsolvencyText(solvent)).toBe(`not insolvent within ${SIM.days} days`);
    const broken = SIM.scenarios.find((s) => s.breaksThePool)!;
    expect(timeToInsolvencyText(broken)).toMatch(/runs\)$/);
  });

  it("shows the breaking scenario's probability unsoftened", () => {
    const broken = SIM.scenarios.find((s) => s.breaksThePool)!;
    expect(broken.pInsolvency.p).toBeGreaterThan(0.9);
    expect(probabilityText(broken)).toMatch(/^9\d\.\d%/);
  });

  it.skipIf(!has)("matches the results folder it says it came from", () => {
    const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
    expect(summary.date).toBe(SIM.date);
    expect(summary.scenarios.map((s: { id: string }) => s.id)).toEqual(SIM.scenarios.map((s) => s.id));
    for (const s of summary.scenarios) {
      const mine = SIM.scenarios.find((x) => x.id === s.id)!;
      expect(mine.pInsolvency).toEqual(s.probabilityInsolvency);
      expect(mine.endingCapitalNear).toEqual(s.endingCapitalNear);
      expect(mine.timeToInsolvencyDays).toEqual(s.timeToInsolvencyDays);
    }
  });
});
