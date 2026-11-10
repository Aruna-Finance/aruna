import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WalletButton } from "./WalletButton";

describe("WalletButton", () => {
  it("offers to connect when no wallet is connected", () => {
    const html = renderToStaticMarkup(<WalletButton />);
    expect(html).toContain("Connect wallet");
    expect(html).not.toContain("Disconnect");
  });
});
