import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultHistory } from "../history";
import { MyVaults, vaultListNeedsIndexer } from "./CreateVault";

describe("your vaults", () => {
  it("says it is reading, and never claims the account has no vaults before the registry has answered", () => {
    const out = renderToStaticMarkup(<MyVaults account="owner.testnet" history={defaultHistory()} />);
    expect(out).toContain("Reading your vaults.");
    expect(out).not.toContain("No vaults found");
  });

  it("shows nothing without a wallet", () => {
    expect(renderToStaticMarkup(<MyVaults account={null} history={defaultHistory()} />)).toBe("");
  });

  it("names what the registry cannot list: vaults only operated, or whose ownership moved", () => {
    expect(vaultListNeedsIndexer).toContain("only operate");
    expect(vaultListNeedsIndexer).toContain("ownership moved");
  });
});
