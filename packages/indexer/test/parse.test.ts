import { describe, expect, it } from "vitest";
import { extractRecords } from "../src/ingest/parse.js";
import { WatchSet } from "../src/ingest/watch.js";
import { clone, eventLine, recordedBlocks, SEEDS } from "./helpers.js";

const blocks = recordedBlocks();
const DEMO2 = "demo2.factory.arunafi.testnet";
const watchWithDemo2 = () => {
  const w = new WatchSet(SEEDS);
  w.addVault(DEMO2, "factory.arunafi.testnet");
  return w;
};

describe("extractRecords", () => {
  it("finds the one class_refreshed of block 277069040, from demo2, with its tx and height", () => {
    const recs = extractRecords(blocks.get(277069040)!, watchWithDemo2());
    const events = recs.filter((r) => r.kind === "event");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "event",
      contract: DEMO2,
      name: "class_refreshed",
      block: 277069040,
      tx_hash: "At17sV6yJpARbtH9w4rPkT5w3qpATRxcddfeqZ1ALLrZ",
      receipt_id: "Eg5RVhwq3Ckwa7464do6ZkDfKLG1s6TxZPP7MKu3QrcP",
      timestamp_ms: 1794314648700,
    });
  });

  it("keeps both events of one receipt, in log order", () => {
    const recs = extractRecords(blocks.get(277069014)!, watchWithDemo2());
    expect(recs.map((r) => r.name)).toEqual(["execution_rejected", "agent_auto_disabled"]);
    expect(recs.map((r) => r.idx)).toEqual([0, 1]);
  });

  it("ignores a valid-looking aruna event from an account outside the watched set", () => {
    const b = clone(blocks.get(277069040)!);
    for (const s of b.shards) for (const o of s.receipt_execution_outcomes ?? []) o.execution_outcome.outcome.executor_id = "impostor.testnet";
    expect(extractRecords(b, watchWithDemo2())).toEqual([]);
  });

  it("ignores events from a receipt that failed, since its state was reverted", () => {
    const b = clone(blocks.get(277069014)!);
    for (const s of b.shards) for (const o of s.receipt_execution_outcomes ?? []) o.execution_outcome.outcome.status = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: x" } } } } };
    expect(extractRecords(b, watchWithDemo2())).toEqual([]);
  });

  it("stores create_vault arguments from a watched factory, then adds the vault on vault_created", () => {
    const w = new WatchSet(SEEDS);
    const call = extractRecords(blocks.get(277068623)!, w);
    expect(call).toEqual([
      expect.objectContaining({
        kind: "call",
        contract: "factory.arunafi.testnet",
        name: "create_vault",
        data: expect.objectContaining({ name: "demo2", owner: "demo-client.arunafi.testnet", operator: "demo-company.arunafi.testnet" }),
        tx_hash: "9krcc5BarPuzCsYZWULhZRWhxzfXg7NqKBwh7yY4SzwG",
      }),
    ]);
    expect(w.has(DEMO2)).toBe(false);
    const created = extractRecords(blocks.get(277068625)!, w);
    expect(created.map((r) => r.name)).toEqual(["vault_created"]);
    expect(w.has(DEMO2)).toBe(true);
  });

  it("does not add a vault for vault_created from an unwatched account", () => {
    const b = clone(blocks.get(277068625)!);
    for (const s of b.shards) for (const o of s.receipt_execution_outcomes ?? []) o.execution_outcome.outcome.executor_id = "fake-factory.testnet";
    const w = new WatchSet(SEEDS);
    expect(extractRecords(b, w)).toEqual([]);
    expect(w.has(DEMO2)).toBe(false);
  });

  it("keeps an unknown event name raw and flagged, and still parses the others in the receipt", () => {
    const b = clone(blocks.get(277069014)!);
    const o = b.shards.flatMap((s) => s.receipt_execution_outcomes ?? [])[0];
    o.execution_outcome.outcome.logs.splice(1, 0, eventLine("future_thing", { x: 1 }));
    const recs = extractRecords(b, watchWithDemo2());
    expect(recs.map((r) => [r.kind, r.name])).toEqual([
      ["event", "execution_rejected"],
      ["unparsed", "future_thing"],
      ["event", "agent_auto_disabled"],
    ]);
  });

  it("keeps a malformed EVENT_JSON line raw and flagged without stopping", () => {
    const b = clone(blocks.get(277069014)!);
    const o = b.shards.flatMap((s) => s.receipt_execution_outcomes ?? [])[0];
    o.execution_outcome.outcome.logs.unshift("EVENT_JSON:{not json");
    const recs = extractRecords(b, watchWithDemo2());
    expect(recs[0]).toMatchObject({ kind: "unparsed", name: null, data: { line: "EVENT_JSON:{not json" } });
    expect(recs.slice(1).map((r) => r.name)).toEqual(["execution_rejected", "agent_auto_disabled"]);
  });

  it("flags a known event missing a field it needs as unparsed", () => {
    const b = clone(blocks.get(277069048)!);
    for (const o of b.shards.flatMap((s) => s.receipt_execution_outcomes ?? []))
      o.execution_outcome.outcome.logs = o.execution_outcome.outcome.logs.map((l) => (l.includes("exposure_recorded") ? eventLine("exposure_recorded", { agent: "ed25519:x", target: "swap.arunafi.testnet" }) : l));
    const recs = extractRecords(b, watchWithDemo2());
    expect(recs.find((r) => r.name === "exposure_recorded")?.kind).toBe("unparsed");
  });

  it("ignores logs that are not aruna events", () => {
    const b = clone(blocks.get(277069040)!);
    const o = b.shards.flatMap((s) => s.receipt_execution_outcomes ?? []).find((x) => x.execution_outcome.outcome.logs.length)!;
    o.execution_outcome.outcome.logs.push("plain log line", `EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer", data: [] })}`);
    expect(extractRecords(b, watchWithDemo2()).map((r) => r.name)).toEqual(["class_refreshed"]);
  });
});
