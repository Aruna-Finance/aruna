import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultHistory } from "../history";
import { MyVaults, vaultListNeedsIndexer } from "./CreateVault";

describe("your vaults without an indexer", () => {
  it("says the list needs the indexer and links to Lookup, instead of claiming the account has no vaults", () => {
    const history = defaultHistory();
    const out = renderToStaticMarkup(<MyVaults account="owner.testnet" history={history} />);
    expect(out).toContain(vaultListNeedsIndexer.replace("'", "&#x27;"));
    expect(out).toContain('href="/console/lookup"');
    expect(out).not.toContain("No vaults found");
  });
});
