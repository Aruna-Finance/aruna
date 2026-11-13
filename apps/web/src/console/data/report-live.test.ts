import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReportRow } from "./claims-live";
import { CHALLENGE_WINDOW_BLOCKS, STATE_TEXT, timelineOf, windowBlocksLeft } from "./report-live";

const rep = (o: Partial<ReportRow> = {}): ReportRow => ({ id: 2, target: "t.testnet", attestor: "a.testnet", channel: "deploy_global_contract", state: "pending", changedAtBlock: 100, observedAtBlock: 101, reportedAtBlock: 110, beforeHash: "x", afterHash: "y", nonce: 1, disputedBy: null, ...o });

describe("challenge window", () => {
  it("is the contract's constant", () => {
    const params = readFileSync(fileURLToPath(new URL("../../../../../contracts/common/src/params.rs", import.meta.url)), "utf8");
    expect(params).toContain(`pub const CHALLENGE_WINDOW_BLOCKS: u64 = ${CHALLENGE_WINDOW_BLOCKS};`);
  });
  it("counts the blocks left from the block the report was made", () => {
    expect(windowBlocksLeft(rep(), 110)).toBe(300);
    expect(windowBlocksLeft(rep(), 410)).toBe(0);
    expect(windowBlocksLeft(rep(), 500)).toBeLessThan(0);
  });
});

describe("report timeline", () => {
  it("shows an open window with the blocks left and nothing paid yet", () => {
    const t = timelineOf(rep(), 200);
    expect(t[1]).toMatchObject({ name: "challenge_window", state: "now" });
    expect(t[1].text).toContain("210 blocks left");
    expect(t[2].state).toBe("");
  });
  it("shows a dispute with the conflicting report, and no claim until the arbiter rules", () => {
    const t = timelineOf(rep({ state: "disputed", disputedBy: 3 }), 200);
    expect(t[1]).toMatchObject({ state: "bad" });
    expect(t[1].text).toContain("report 3");
    expect(t[2].text).toMatch(/refused until it is verified/);
  });
  it("shows a verified report as closed and open to claims, a rejected one as closed to them", () => {
    const v = timelineOf(rep({ state: "verified" }), 500);
    expect(v.map((s) => s.state)).toEqual(["done", "done", "done"]);
    const x = timelineOf(rep({ state: "rejected" }), 500);
    expect(x[2]).toMatchObject({ state: "bad", text: "No claim can use this report." });
  });
  it("has a word for every state the registry reports", () => {
    for (const s of ["pending", "verified", "disputed", "rejected"]) expect(STATE_TEXT[s]).toBeTruthy();
  });
});
