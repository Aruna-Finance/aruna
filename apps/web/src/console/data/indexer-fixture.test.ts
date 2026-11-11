import { describe, expect, it } from "vitest";
import { fixtureIndexerClient } from "./indexer-fixture";

const DEMO2 = "demo2.factory.arunafi.testnet";

describe("indexer fixture answers like the live indexer", () => {
  it("filters events by vault the way the indexer does: a vault's own events belong to it", async () => {
    const p = await fixtureIndexerClient.events({ vault: DEMO2, event: "execution_rejected" });
    expect(p.items).toHaveLength(6);
    expect((await fixtureIndexerClient.events({ vault: "other.testnet" })).items).toEqual([]);
  });

  it("applies target, attestor and coverage filters instead of ignoring them", async () => {
    expect((await fixtureIndexerClient.events({ target: "attacker.testnet" })).items).toHaveLength(2);
    expect((await fixtureIndexerClient.events({ attestor: "attestor-a.arunafi.testnet" })).items).toEqual([]);
    expect((await fixtureIndexerClient.events({ coverage: 2 })).items).toEqual([]);
  });

  it("pages vaults and activity with an after cursor", async () => {
    const first = await fixtureIndexerClient.activity(DEMO2, { limit: 4 });
    expect(first.items).toHaveLength(4);
    const rest = await fixtureIndexerClient.activity(DEMO2, { after: first.next_after!, limit: 100 });
    expect([...first.items, ...rest.items].map((a) => a.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rest.next_after).toBeNull();
    expect((await fixtureIndexerClient.vaults({ after: 1 })).items).toEqual([]);
  });
});
