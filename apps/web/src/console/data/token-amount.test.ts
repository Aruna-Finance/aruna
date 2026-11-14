import { describe, expect, it } from "vitest";
import { amountText } from "./coverage-live";
import { formatUnits, metaOf, parseUnits } from "./token-amount";

describe("token units", () => {
  it("writes an amount in whole units with every digit the token has", () => {
    expect(formatUnits("10000000", 6)).toBe("10");
    expect(formatUnits("27732", 6)).toBe("0.027732");
    expect(formatUnits("800000", 6)).toBe("0.8");
    expect(formatUnits("0", 6)).toBe("0");
    expect(formatUnits("1234567890", 6)).toBe("1,234.56789");
  });
  it("leaves what it cannot read as it was, never a zero", () => {
    expect(formatUnits("abc", 6)).toBe("abc");
    expect(formatUnits("5", -1)).toBe("5");
  });
  it("takes symbol and decimals from the token's metadata and nothing else", () => {
    expect(metaOf({ symbol: "tUSDC", decimals: 6, name: "x" })).toEqual({ symbol: "tUSDC", decimals: 6 });
    expect(metaOf({ symbol: "", decimals: 6 })).toBeNull();
    expect(metaOf({ symbol: "T", decimals: "6" })).toBeNull();
    expect(metaOf(null)).toBeNull();
  });
});

describe("parseUnits", () => {
  it("reads a typed amount into the token's smallest unit, with integer arithmetic only", () => {
    expect(parseUnits("12.5", 6)).toBe(12_500_000n);
    expect(parseUnits("1", 24)).toBe(10n ** 24n);
    expect(parseUnits(".5", 6)).toBe(500_000n);
    expect(parseUnits(" 0.000001 ", 6)).toBe(1n);
  });
  it("takes nothing it cannot read exactly: signs, exponents, separators, extra digits", () => {
    for (const t of ["", "-1", "1e3", "1,5", "1.2.3", "abc", "0.0000001", "1."]) expect(parseUnits(t, 6)).toBeNull();
    expect(parseUnits("1.5", 0)).toBeNull();
  });
});

describe("amount text", () => {
  it("uses the token's symbol once its metadata is known, and says the unit until then", () => {
    expect(amountText("usdc.arunafi.testnet", "10000000", { symbol: "tUSDC", decimals: 6 })).toBe("10 tUSDC");
    expect(amountText("usdc.arunafi.testnet", "10000000")).toBe("10000000 (smallest unit of usdc.arunafi.testnet)");
    expect(amountText("near", "1000000000000000000000000")).toBe("1 NEAR");
  });
});
