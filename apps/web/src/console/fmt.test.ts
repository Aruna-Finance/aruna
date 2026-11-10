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
