import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_BOOT, THEME_KEY } from "./theme";

describe("which theme the console opens in", () => {
  it("is dark by default and light only when the person chose light", () => {
    expect(resolveTheme(null)).toBe("dark");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("purple")).toBe("dark");
  });
  it("sets the theme before paint from the same storage key", () => {
    expect(THEME_BOOT).toContain(THEME_KEY);
    expect(THEME_BOOT).toContain('"light"');
  });
});
