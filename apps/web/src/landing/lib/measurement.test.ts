import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MEASUREMENT, basisCallsShare, callsShare, classRows } from "./measurement";

const dir = join(process.cwd(), "../..", MEASUREMENT.generatedFrom);
const has = existsSync(join(dir, "results.jsonl"));

describe("mainnet measurement data", () => {
  it("adds up", () => {
    expect(MEASUREMENT.classes.reduce((s, c) => s + c.accounts, 0)).toBe(MEASUREMENT.classified);
    expect(MEASUREMENT.classified + MEASUREMENT.failed.length).toBe(MEASUREMENT.total);
    expect(MEASUREMENT.bases.reduce((s, b) => s + b.accounts, 0)).toBe(MEASUREMENT.classified);
    expect(MEASUREMENT.classes.reduce((s, c) => s + c.calls, 0)).toBe(MEASUREMENT.totalCalls);
    expect(MEASUREMENT.invisible).toHaveLength(MEASUREMENT.classes.find((c) => c.class === "global_by_account")!.accounts);
  });

  it("formats shares from the counts", () => {
    expect(classRows()[0]).toHaveLength(5);
    expect(callsShare("local_upgradeable")).toMatch(/%$/);
    expect(basisCallsShare("nope")).toBe("n/a");
  });

  it.skipIf(!has)("matches the results folder it says it came from", () => {
    const rows = readFileSync(join(dir, "results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const ok = rows.filter((r: { ok: boolean }) => r.ok);
    expect(ok.length).toBe(MEASUREMENT.classified);
    for (const c of MEASUREMENT.classes) {
      const mine = ok.filter((r: { classification: { class: string } }) => r.classification.class === c.class);
      expect(mine.length).toBe(c.accounts);
      expect(mine.reduce((s: number, r: { calls?: number }) => s + (r.calls ?? 0), 0)).toBe(c.calls);
    }
  });
});
