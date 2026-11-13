import { describe, expect, it } from "vitest";
import { REASONS } from "@aruna/sdk";
import { REASON_TEXT, reasonText } from "./reason-text";

describe("refusal reasons in plain words", () => {
  it("has a sentence for every reason the SDK knows, and no raw code in it", () => {
    for (const r of REASONS) {
      expect(REASON_TEXT[r]).toMatch(/^[A-Z].*\.$/);
      expect(REASON_TEXT[r]).not.toContain("_");
    }
  });
  it("accepts the contract value and the SDK code", () => {
    expect(reasonText("ARUNA_MAX_PER_TX_EXCEEDED")).toBe(reasonText("MAX_PER_TX_EXCEEDED"));
    expect(reasonText("SOMETHING_ELSE")).toBeNull();
  });
});
