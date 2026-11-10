import { describe, expect, it } from "vitest";
import { connectErrorMessage } from "./WalletContext";

describe("connectErrorMessage", () => {
  it("treats closing the wallet modal as a cancel", () => {
    expect(connectErrorMessage(new Error("User closed the window"))).toBeNull();
    expect(connectErrorMessage(new Error("Request rejected"))).toBeNull();
    expect(connectErrorMessage("cancelled")).toBeNull();
    expect(connectErrorMessage(undefined)).toBeNull();
  });
  it("shows a real failure", () => {
    expect(connectErrorMessage(new Error("Network request failed"))).toBe("Network request failed");
  });
});
