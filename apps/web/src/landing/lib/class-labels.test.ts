import { describe, expect, it } from "vitest";
import { CLASS_HINT, CLASS_LABEL, classHint, classLabelOf } from "./class-labels";

describe("class labels", () => {
  it("labels every class in plain words and never shows the raw name as the label", () => {
    for (const [raw, label] of Object.entries(CLASS_LABEL)) {
      expect(label).not.toContain("_");
      expect(label).not.toBe(raw);
      expect(CLASS_HINT[raw as keyof typeof CLASS_HINT].length).toBeGreaterThan(20);
    }
  });
  it("keeps the technical name in the tooltip", () => {
    expect(classHint("global_by_account")).toContain("Technical class: global_by_account.");
  });
  it("says unknown cannot be covered", () => {
    expect(CLASS_LABEL.unknown).toContain("not coverable");
  });
  it("shows an unrecognised chain value as it is", () => {
    expect(classLabelOf("local_upgradeable")).toBe("Upgradeable by owner");
    expect(classLabelOf("something_new")).toBe("something_new");
  });
});
