import { describe, expect, it } from "vitest";
import { mockTargets } from "./mock";

describe("mock targets", () => {
  it("lists the prototype's seven targets and covers all four risk classes", async () => {
    const list = await mockTargets.list();
    expect(list.map((t) => t.id)).toEqual([
      "vault.testnet",
      "dex.testnet",
      "router.testnet",
      "router-2.testnet",
      "lend.testnet",
      "vault-budi.aruna.testnet",
      "bridge.testnet",
    ]);
    expect(new Set(list.map((t) => t.classification.class)).size).toBe(4);
  });

  it("offers nine test cases and adds a classified target once", async () => {
    expect((await mockTargets.presets()).length).toBe(9);
    const first = await mockTargets.classify("hash-full");
    expect(first.added).toBe(true);
    expect(first.record.classification.class).toBe("local_upgradeable");
    expect((await mockTargets.classify("hash-full")).added).toBe(false);
  });

  it("returns null for an unknown id", async () => {
    expect(await mockTargets.get("nobody.testnet")).toBeNull();
  });
});
