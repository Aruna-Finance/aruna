import { describe, expect, it } from "vitest";
import { yoctoToNear } from "./fmt";

describe("yoctoToNear", () => {
  it("converts with integers only", () => {
    expect(yoctoToNear("1000000000000000000000000")).toBe("1");
    expect(yoctoToNear("1500000000000000000000000")).toBe("1.5");
    expect(yoctoToNear("0")).toBe("0");
    expect(yoctoToNear("123456789000000000000000000")).toBe("123.4567");
  });
  it("returns the input when it is not a number", () => {
    expect(yoctoToNear("n/a")).toBe("n/a");
  });
});

describe("nearToYocto", () => {
  it("converts whole and fractional NEAR without a float in the result", async () => {
    const { nearToYocto } = await import("./fmt");
    expect(nearToYocto(0.5)).toBe(500000000000000000000000n);
    expect(nearToYocto(1)).toBe(10n ** 24n);
    expect(nearToYocto(0.000001)).toBe(10n ** 18n);
  });
  it("is zero for a blank, negative or non-finite entry", async () => {
    const { nearToYocto } = await import("./fmt");
    expect(nearToYocto(NaN)).toBe(0n);
    expect(nearToYocto(-1)).toBe(0n);
    expect(nearToYocto(Infinity)).toBe(0n);
  });
});
