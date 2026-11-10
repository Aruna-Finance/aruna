import { AUTO_DISABLE_REASONS, REASONS } from "@aruna/sdk";
import { describe, expect, it } from "vitest";
import { REFUSALS } from "../landing/lib/facts";

// The reasons table on the Developers screen comes from landing/lib/facts. It must equal the SDK's set, which a
// SDK test pins to the contract (CLAUDE.md: SDK reason codes are the contract names without the prefix).
describe("refusal reasons on the Developers screen", () => {
  it("match the SDK set", () => {
    const shown = REFUSALS.map((r) => r.reason.replace(/^ARUNA_/, "")).sort();
    expect(shown).toEqual([...REASONS].sort());
  });

  it("count toward auto-disable exactly as the SDK says", () => {
    const counted = REFUSALS.filter((r) => r.counts).map((r) => r.reason.replace(/^ARUNA_/, "")).sort();
    expect(counted).toEqual([...AUTO_DISABLE_REASONS].sort());
  });
});
