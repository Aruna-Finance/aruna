import { describe, expect, it } from "vitest";
import { mergeVaultRows, newestOwned, ownedVaults, type RegisteredLike } from "./owned-vaults";

const reg = (byHash: Record<string, RegisteredLike[]>) => ({ vaultsByCodeHash: async (h: string) => byHash[h] ?? [] });
const row = (vault: string, owner: string, block: number): RegisteredLike => ({ vault, owner, registered_at_block: block });

describe("ownedVaults", () => {
  const hashes = { H2: "v2", H4: "v4" };
  it("keeps only the account's vaults across versions, newest first", async () => {
    const r = reg({ H2: [row("old.f", "me", 10), row("theirs.f", "you", 50)], H4: [row("new.f", "me", 99), row("mid.f", "me", 40)] });
    expect(await ownedVaults(r, "me", hashes)).toEqual([
      { vault: "new.f", version: "v4", registeredAtBlock: 99 },
      { vault: "mid.f", version: "v4", registeredAtBlock: 40 },
      { vault: "old.f", version: "v2", registeredAtBlock: 10 },
    ]);
  });
  it("is empty for an account that owns none", async () => {
    expect(await ownedVaults(reg({ H4: [row("a.f", "you", 1)] }), "me", hashes)).toEqual([]);
  });
  it("fails as a whole when one version cannot be read, never a short list", async () => {
    const r = { vaultsByCodeHash: async (h: string) => { if (h === "H4") throw new Error("rpc down"); return []; } };
    await expect(ownedVaults(r, "me", hashes)).rejects.toThrow("rpc down");
  });
});

describe("newestOwned and mergeVaultRows", () => {
  it("opens the newest, or nothing", () => {
    expect(newestOwned([{ vault: "a.f", version: "v4", registeredAtBlock: 9 }])).toBe("a.f");
    expect(newestOwned([])).toBeNull();
  });
  it("lists each vault once, with the owner role over the operator role", () => {
    const merged = mergeVaultRows(
      [{ vault: "a.f", role: "operator" }, { vault: "b.f", role: "operator" }],
      [{ vault: "a.f", version: "v4", registeredAtBlock: 1 }, { vault: "c.f", version: "v4", registeredAtBlock: 2 }],
    );
    expect(merged).toEqual([{ vault: "a.f", role: "owner" }, { vault: "c.f", role: "owner" }, { vault: "b.f", role: "operator" }]);
  });
});
