import { describe, expect, it } from "vitest";
import { runIndexer } from "../src/indexer.js";
import { FIRST, LAST, memorySource, recordedBlocks, SEEDS, testStore } from "./helpers.js";

const DEMO2 = "demo2.factory.arunafi.testnet";
const HONEST = "ed25519:7THAYJHPStMpR3xZjiKoHDdBu6ChQWfG6w93r9sUxHFi";
const INJECTED = "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi";

async function indexed(opts: { failAt?: number } = {}) {
  const store = await testStore();
  const source = memorySource(recordedBlocks(), opts);
  await runIndexer({ store, source, seeds: SEEDS, startBlock: FIRST, stopAt: LAST, concurrency: 8 });
  return { store, source };
}

describe("indexing the recorded demo2 blocks", () => {
  it("discovers demo2 from its factory and lists it under its owner and its operator", async () => {
    const { store } = await indexed();
    const v = (await store.vaults({ operator: "demo-company.arunafi.testnet" })).items;
    expect(v).toEqual([
      {
        vault: DEMO2,
        factory: "factory.arunafi.testnet",
        owner: "demo-client.arunafi.testnet",
        operator: "demo-company.arunafi.testnet",
        code_hash: "4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam",
        created_block: 277068625,
        created_tx: "9krcc5BarPuzCsYZWULhZRWhxzfXg7NqKBwh7yY4SzwG",
      },
    ]);
    expect((await store.vaults({ owner: "demo-client.arunafi.testnet" })).items.map((x) => x.vault)).toEqual([DEMO2]);
    expect((await store.vaults({ code_hash: "4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam" })).items).toHaveLength(1);
  });

  it("records one exposure row with agent, target, token, amount, total, class and tx", async () => {
    const { store } = await indexed();
    const rows = (await store.exposure(DEMO2, {})).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vault: DEMO2,
      agent: HONEST,
      target: "swap.arunafi.testnet",
      token: "near",
      amount: "100000000000000000000000",
      total: "200000000000000000000000",
      class: "local_upgradeable",
      block: 277069048,
      tx_hash: "BqTxFWwXCSmFqkKeQawS8gm8YhpGu9Hwv9qqqJaXuHnJ",
    });
  });

  it("shows the refusal and the auto-disable as activity, with reason and class", async () => {
    const { store } = await indexed();
    const refused = (await store.activity(DEMO2, { agent: INJECTED })).items;
    expect(refused.map((a) => [a.kind, a.reason, a.class])).toEqual([
      ["refused", "ARUNA_TARGET_NOT_ALLOWED", null],
      ["auto_disabled", null, null],
    ]);
    expect((await store.activity(DEMO2, { kind: "class_refreshed" })).items[0].class).toBe("local_upgradeable");
  });

  it("serves registry events through the events table, with the vault extracted", async () => {
    const { store } = await indexed();
    const ev = (await store.events({ event: "vault_deployed" })).items;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ contract: "registry.arunafi.testnet", block: 277068626 });
    expect((await store.events({ vault: DEMO2, event: "vault_created,vault_deployed" })).items.map((e) => e.event)).toEqual(["vault_created", "vault_deployed"]);
  });

  it("reaches the stop block and reports it as indexed", async () => {
    const { store } = await indexed();
    expect(await store.cursor()).toBe(LAST);
    expect((await store.health(LAST)).last_indexed_block).toBe(LAST);
  });

  it("resumes after a crash mid-range without duplicating any event", async () => {
    const store = await testStore();
    const source = memorySource(recordedBlocks(), { failAt: 277068626 });
    const run = () => runIndexer({ store, source, seeds: SEEDS, startBlock: FIRST, stopAt: LAST, concurrency: 8 });
    await expect(run()).rejects.toThrow(/simulated crash/);
    expect(await store.cursor()).toBeLessThan(277068626);
    await run();
    const { store: clean } = await indexed();
    expect(await store.export()).toBe(await clean.export());
  });

  it("produces byte-identical exports from two empty stores fed the same blocks", async () => {
    const a = await indexed();
    const b = await indexed();
    expect(await a.store.export()).toBe(await b.store.export());
    expect(JSON.parse(await a.store.export()).exposure).toHaveLength(1);
  });

  it("paginates by seq with no duplicates and no gaps", async () => {
    const { store } = await indexed();
    const all = (await store.events({})).items.map((e) => e.seq);
    const seen: number[] = [];
    let after: number | undefined;
    for (;;) {
      const p = await store.events({ after, limit: 3 });
      seen.push(...p.items.map((e) => e.seq));
      if (p.next_after === null) break;
      after = p.next_after;
    }
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
