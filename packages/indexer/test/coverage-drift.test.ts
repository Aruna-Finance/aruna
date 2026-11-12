// Coverage, claims and drift (R7). Every event below is a real one: fixtures/golden/events-pool.json and
// events-registry.json are written by the pool's and the registry's own tests from the contracts' code
// (ARUNA_WRITE_GOLDEN=1 cargo test -p aruna-pool golden_events, and -p aruna-registry golden_events), so a
// changed event shape fails there first. Nothing here is invented.
import { mkdtempSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHALLENGE_WINDOW_BLOCKS, HEARTBEAT_STALE_BLOCKS } from "../src/api.js";
import { createIndexerClient } from "../src/client.js";
import { extractRecords, type RawRecord } from "../src/ingest/parse.js";
import type { NeardataBlock } from "../src/ingest/neardata.js";
import { WatchSet } from "../src/ingest/watch.js";
import { handle } from "../src/routes.js";
import { startServer } from "../src/server.js";
import { openStore, type Store } from "../src/store.js";
import { SEEDS } from "./helpers.js";

const REGISTRY = "registry2.arunafi.testnet";
const POOL = "pool2.arunafi.testnet";
const TARGET = "fx-guser.arunafi.testnet";
const NEAR = 10n ** 24n;

interface Golden {
  block: number;
  event: string;
  data: Record<string, unknown>;
}
const golden = (name: string): Golden[] => JSON.parse(readFileSync(new URL(`../../../fixtures/golden/${name}`, import.meta.url), "utf8")).events;
const poolEvents = golden("events-pool.json");
const registryEvents = golden("events-registry.json");

let receiptN = 0;
const record = (contract: string, e: Golden): RawRecord => ({ kind: "event", contract, name: e.event, data: e.data, block: e.block, timestamp_ms: e.block * 1000, tx_hash: `tx-${e.block}-${e.event}`, receipt_id: `r${receiptN++}`, idx: 0 });

/** Commits `events` into a store, one block at a time from the first event's block to `through`, empty blocks in between. */
function load(contract: string, events: Golden[], through?: number, into: Store = openStore(":memory:")): Store {
  const first = events[0].block;
  const last = through ?? events[events.length - 1].block;
  for (let h = first; h <= last; h++) into.commitBlock(h, events.filter((e) => e.block === h).map((e) => record(contract, e)));
  return into;
}

const get = (store: Store, url: string) => {
  const r = handle(store, "GET", url);
  return { status: r.status, body: JSON.parse(r.body) as { items: any[]; last_indexed_block: number; next_after: number | null; error?: string } };
};

describe("the parser knows every real event the contracts emit", () => {
  it("keeps none of the pool's or the registry's events as unparsed", () => {
    for (const [contract, events] of [[POOL, poolEvents], [REGISTRY, registryEvents]] as const) {
      const block = (e: Golden, i: number): NeardataBlock => ({
        block: { header: { height: e.block, hash: `h${i}`, timestamp_nanosec: "1794000000000000000" } },
        shards: [
          {
            receipt_execution_outcomes: [
              {
                tx_hash: `t${i}`,
                receipt: null,
                execution_outcome: { id: `r${i}`, outcome: { executor_id: contract, logs: [`EVENT_JSON:${JSON.stringify({ standard: "aruna", version: "1.0.0", event: e.event, data: [e.data] })}`], status: { SuccessValue: "" } } },
              },
            ],
          },
        ],
      });
      const watch = new WatchSet(SEEDS);
      const out = events.flatMap((e, i) => extractRecords(block(e, i), watch));
      expect(out.filter((r) => r.kind === "unparsed"), contract).toEqual([]);
      expect(out.map((r) => r.name)).toEqual(events.map((e) => e.event));
    }
  });
});

describe("coverage and claims, from the pool's real events", () => {
  const last = poolEvents[poolEvents.length - 1].block;
  const purchase = poolEvents.find((e) => e.event === "coverage_purchased")!;
  const cov = (purchase.data.coverage as Record<string, unknown>);
  const store = openStore(":memory:");
  // One store, advanced block by block, read at each checkpoint: the clock decides the status. The tests
  // below read it as the first one left it, at the last block.
  const advance = (to: number) => {
    const from = (store.cursor() ?? purchase.block - 1) + 1;
    for (let h = from; h <= to; h++) store.commitBlock(h, poolEvents.filter((e) => e.block === h).map((e) => record(POOL, e)));
  };
  const waitingEnds = cov.waiting_period_ends as number;
  const endBlock = cov.end_block as number;

  it("a coverage is waiting, then active, then expired, then released, by the indexed block", () => {
    advance(purchase.block);
    expect(get(store, "/v1/coverages").body.items.map((c) => c.status)).toEqual(["waiting"]);
    advance(waitingEnds - 1);
    expect(get(store, "/v1/coverages?status=waiting").body.items).toHaveLength(1);
    advance(waitingEnds);
    expect(get(store, "/v1/coverages?status=waiting").body.items).toHaveLength(0);
    expect(get(store, "/v1/coverages?status=active").body.items).toHaveLength(1);
    advance(endBlock);
    expect(get(store, "/v1/coverages").body.items[0].status).toBe("active");
    advance(endBlock + 1);
    expect(get(store, "/v1/coverages").body.items[0].status).toBe("expired");
    expect(get(store, "/v1/coverages?status=expired").body.items).toHaveLength(1);
    expect(get(store, "/v1/coverages?status=active").body.items).toHaveLength(0);
    advance(last);
    expect(get(store, "/v1/coverages").body.items[0].status).toBe("released");
    expect(get(store, "/v1/coverages?status=released").body.items).toHaveLength(1);
  });

  it("carries the whole coverage record, and what the claims did to it", () => {
    const c = get(store, "/v1/coverages").body.items[0];
    expect(c).toMatchObject({
      pool: POOL,
      id: 0,
      owner: "client.testnet",
      vault: "v.factory.testnet",
      target: "t.testnet",
      token: "near",
      limit: String(10n * NEAR),
      payout_ratio_bps: 8000,
      class: "local_upgradeable",
      code_hash: "H1",
      claims_paid: 1,
      claims_rejected: 1,
      released: true,
    });
    expect(c.paid_out).toBe(String((3n * NEAR * 8000n) / 10_000n));
    expect(c.premium_paid).toBe(cov.premium_paid);
    expect(c.tx_hash).toBe(`tx-${purchase.block}-coverage_purchased`);
  });

  it("filters coverages per vault, owner, target, token and pool, and an unknown value is an empty page", () => {
    expect(get(store, "/v1/coverages?vault=v.factory.testnet").body.items).toHaveLength(1);
    expect(get(store, "/v1/coverages?owner=client.testnet&target=t.testnet&token=near").body.items).toHaveLength(1);
    expect(get(store, `/v1/coverages?pool=${POOL}`).body.items).toHaveLength(1);
    expect(get(store, "/v1/coverages?pool=pool.arunafi.testnet").body.items).toEqual([]);
    expect(get(store, "/v1/coverages?vault=other.testnet").body.items).toEqual([]);
    expect(get(store, "/v1/coverages?token=usdc.testnet").body.items).toEqual([]);
  });

  it("lists claims with every term of a payout: min(exposure x ratio, remaining limit)", () => {
    const all = get(store, "/v1/claims").body.items;
    expect(all.map((c) => c.outcome)).toEqual(["rejected", "paid"]);
    expect(all[0]).toMatchObject({ outcome: "rejected", reason: "challenge window still open", payout: null, vault: "v.factory.testnet", target: "t.testnet" });
    const paid = all[1];
    expect(paid).toMatchObject({ coverage: 0, report: 0, outcome: "paid", payout_ratio_bps: 8000, to: "client.testnet", token: "near", vault: "v.factory.testnet", owner: "client.testnet" });
    const [exposure, ratio, limit, before] = [BigInt(paid.exposure_in_window), BigInt(paid.payout_ratio_bps), BigInt(paid.limit), BigInt(paid.paid_before)];
    expect(BigInt(paid.payout)).toBe([(exposure * ratio) / 10_000n, limit - before].reduce((a, b) => (a < b ? a : b)));
    expect(paid.exposure_before_change).toBe(paid.exposure_in_window);
    expect(paid.exposure_through_last_paid_block).toBe("0");
  });

  it("filters claims by outcome, coverage, vault and pool", () => {
    expect(get(store, "/v1/claims?outcome=paid").body.items).toHaveLength(1);
    expect(get(store, "/v1/claims?outcome=rejected").body.items).toHaveLength(1);
    expect(get(store, "/v1/claims?coverage=0").body.items).toHaveLength(2);
    expect(get(store, "/v1/claims?coverage=7").body.items).toEqual([]);
    expect(get(store, "/v1/claims?vault=v.factory.testnet").body.items).toHaveLength(2);
    expect(get(store, `/v1/claims?pool=${POOL}`).body.items).toHaveLength(2);
  });

  it("a refused purchase and the underwriter's deposit and withdrawal are events, not coverages", () => {
    expect(get(store, "/v1/events?event=coverage_refused").body.items).toHaveLength(1);
    expect(get(store, "/v1/events?event=capital_deposited,capital_withdrawn").body.items).toHaveLength(2);
    expect(get(store, "/v1/coverages").body.items).toHaveLength(1);
  });

  it("every page says how far the indexer has read", () => {
    expect(get(store, "/v1/coverages").body.last_indexed_block).toBe(last);
    expect(get(store, "/v1/claims").body.last_indexed_block).toBe(last);
  });
});

describe("drift reports, freezes, heartbeats, attestors and classes, from the registry's real events", () => {
  const store = load(REGISTRY, registryEvents);
  const last = registryEvents[registryEvents.length - 1].block;
  const reportedAt = (n: number) => registryEvents.filter((e) => e.event === "drift_reported")[n].block;

  it("keeps the two reports of a dispute and settles both on the ruling", () => {
    const reports = get(store, "/v1/reports").body.items;
    expect(reports.map((r) => [r.id, r.attestor, r.state, r.disputed_by])).toEqual([
      [0, "attestor-a.arunafi.testnet", "verified", 1],
      [1, "attestor-b.arunafi.testnet", "rejected", 0],
    ]);
    expect(reports[0]).toMatchObject({ registry: REGISTRY, target: TARGET, channel: "deploy_global_contract", before_resolved_hash: "BEFORE", after_resolved_hash: "AFTER", reported_at_block: reportedAt(0) });
    expect(reports[0].challenge_window_ends).toBe(reportedAt(0) + CHALLENGE_WINDOW_BLOCKS);
    expect(reports[0].before_ref).toEqual({ kind: "global_account", owner_account: "fx-gowner.arunafi.testnet" });
    expect(get(store, "/v1/reports?state=rejected").body.items.map((r) => r.id)).toEqual([1]);
    expect(get(store, "/v1/reports?state=verified").body.items.map((r) => r.id)).toEqual([0]);
    expect(get(store, "/v1/reports?state=disputed").body.items).toEqual([]);
    expect(get(store, "/v1/reports?attestor=attestor-b.arunafi.testnet").body.items.map((r) => r.id)).toEqual([1]);
    expect(get(store, `/v1/reports?target=${TARGET}`).body.items).toHaveLength(2);
    expect(get(store, "/v1/reports?target=other.testnet").body.items).toEqual([]);
  });

  it("while two reports dispute each other, both read disputed", () => {
    const s = load(REGISTRY, registryEvents, registryEvents.find((e) => e.event === "report_disputed")!.block);
    expect(get(s, "/v1/reports").body.items.map((r) => [r.id, r.state])).toEqual([[0, "disputed"], [1, "disputed"]]);
    expect(get(s, "/v1/reports?state=disputed").body.items).toHaveLength(2);
    expect(get(s, "/v1/reports?state=pending").body.items).toEqual([]);
  });

  it("a pending report reads as verified once the challenge window has passed, as the registry does", () => {
    const first = registryEvents.find((e) => e.event === "drift_reported")!;
    expect(first.data.state).toBe("pending");
    const s = load(REGISTRY, [first], first.block + CHALLENGE_WINDOW_BLOCKS - 1);
    expect(get(s, "/v1/reports").body.items[0].state).toBe("pending");
    expect(get(s, "/v1/reports?state=pending").body.items).toHaveLength(1);
    expect(get(s, "/v1/reports?state=verified").body.items).toHaveLength(0);
    s.commitBlock(first.block + CHALLENGE_WINDOW_BLOCKS, []);
    expect(get(s, "/v1/reports").body.items[0].state).toBe("verified");
    expect(get(s, "/v1/reports?state=verified").body.items).toHaveLength(1);
    expect(get(s, "/v1/reports?state=pending").body.items).toHaveLength(0);
  });

  it("freezes: a report freezes the target, a push sends it to vaults, a lift ends it; the last one says whether it is frozen", () => {
    const f = get(store, `/v1/freezes?target=${TARGET}`).body.items;
    expect(f.map((x) => [x.kind, x.report_id, x.frozen_after])).toEqual([["frozen", 0, true], ["frozen", 1, true], ["pushed", null, true], ["lifted", null, false]]);
    expect(f[2]).toMatchObject({ from: 0, to: 0 });
    expect(f[f.length - 1].frozen_after).toBe(false);
    expect(get(store, "/v1/freezes?target=other.testnet").body.items).toEqual([]);
    expect(get(store, `/v1/freezes?registry=${REGISTRY}`).body.items).toHaveLength(4);
  });

  it("attestors: bond, heartbeat, targets, reports filed, and the slash that follows losing a dispute", () => {
    const [a, b] = get(store, "/v1/attestors").body.items;
    expect(a).toMatchObject({ attestor: "attestor-a.arunafi.testnet", targets: [TARGET], reports_filed: 1, slashed: "0", alive: true });
    expect(a.bond).not.toBe("0");
    expect(a.last_heartbeat_block).toBe(registryEvents.find((e) => e.event === "heartbeat")!.block);
    expect(b).toMatchObject({ attestor: "attestor-b.arunafi.testnet", targets: [], reports_filed: 1, bond: "0", alive: false });
    expect(b.slashed).toBe(String(registryEvents.find((e) => e.event === "report_ruled")!.data.slashed));
    expect(BigInt(b.slashed)).toBeGreaterThan(0n);
    expect(get(store, "/v1/attestors?attestor=attestor-a.arunafi.testnet").body.items).toHaveLength(1);
  });

  it("an attestor is alive only while its heartbeat is within the staleness bound", () => {
    const beat = registryEvents.find((e) => e.event === "heartbeat")!.block;
    const s = load(REGISTRY, registryEvents);
    for (let h = last + 1; h <= beat + HEARTBEAT_STALE_BLOCKS; h++) s.commitBlock(h, []);
    expect(get(s, "/v1/attestors?attestor=attestor-a.arunafi.testnet").body.items[0].alive).toBe(true);
    s.commitBlock(beat + HEARTBEAT_STALE_BLOCKS + 1, []);
    expect(get(s, "/v1/attestors?attestor=attestor-a.arunafi.testnet").body.items[0].alive).toBe(false);
  });

  it("heartbeats, per attestor and per target (the attestor assigned to it)", () => {
    const beat = registryEvents.find((e) => e.event === "heartbeat")!.block;
    expect(get(store, "/v1/heartbeats?attestor=attestor-a.arunafi.testnet").body.items.map((h) => h.heartbeat_block)).toEqual([beat]);
    expect(get(store, `/v1/heartbeats?target=${TARGET}`).body.items.map((h) => h.attestor)).toEqual(["attestor-a.arunafi.testnet"]);
    expect(get(store, "/v1/heartbeats?target=unassigned.testnet").body.items).toEqual([]);
    expect(get(store, `/v1/heartbeats?target=${TARGET}&attestor=attestor-b.arunafi.testnet`).body.items).toEqual([]);
    expect(get(store, "/v1/heartbeats?attestor=attestor-b.arunafi.testnet").body.items).toEqual([]);
  });

  it("class changes, oldest first, each saying what the class was before", () => {
    const c = get(store, `/v1/classes?target=${TARGET}`).body.items;
    expect(c.map((x) => [x.class, x.previous_class, x.frozen])).toEqual([["local_upgradeable", null, false], ["global_by_account", "local_upgradeable", false]]);
    expect(c[0]).toMatchObject({ registry: REGISTRY, classifier: "owner.testnet", upgrade_authority: "code-owner.testnet", resolved_code_hash: "HASH-A", evidence_hash: "evidence-1" });
    expect(get(store, "/v1/classes?target=other.testnet").body.items).toEqual([]);
  });

  it("every page says how far the indexer has read", () => {
    for (const route of ["reports", "freezes", "heartbeats", "attestors", "classes"]) expect(get(store, `/v1/${route}`).body.last_indexed_block).toBe(last);
  });
});

describe("the routes", () => {
  const store = load(REGISTRY, registryEvents);

  it("refuses a value outside the lists, and a coverage that is not an integer, as a 400 that says so", () => {
    expect(get(store, "/v1/coverages?status=bogus")).toMatchObject({ status: 400 });
    expect(get(store, "/v1/coverages?status=bogus").body.error).toMatch(/status must be one of waiting, active, expired, released/);
    expect(get(store, "/v1/claims?outcome=maybe").body.error).toMatch(/outcome must be one of paid, rejected/);
    expect(get(store, "/v1/reports?state=final").body.error).toMatch(/state must be one of pending, disputed, verified, rejected/);
    expect(get(store, "/v1/claims?coverage=abc").body.error).toMatch(/coverage must be an integer/);
  });

  it("pages with limit and after, with no item twice and none missing", () => {
    const seen: number[] = [];
    let after = -1;
    let pages = 0;
    for (;;) {
      const page: { items: { seq: number }[]; next_after: number | null } = get(store, `/v1/freezes?limit=3&after=${after}`).body;
      seen.push(...page.items.map((i) => i.seq));
      pages++;
      if (page.next_after === null) break;
      after = page.next_after;
    }
    expect(seen).toEqual(get(store, "/v1/freezes").body.items.map((i) => i.seq));
    expect(pages).toBe(2);
  });

  it("is GET only, with open CORS", () => {
    expect(handle(store, "POST", "/v1/coverages").status).toBe(405);
    expect(handle(store, "GET", "/v1/coverages").headers["access-control-allow-origin"]).toBe("*");
  });

  it("is served over HTTP and read by the typed client, which still answers the older routes too", async () => {
    const s = await startServer({ store, port: 0 });
    try {
      const client = createIndexerClient({ baseUrl: `http://127.0.0.1:${(s.server.address() as AddressInfo).port}` });
      const reports = await client.reports({ target: TARGET, state: "verified" });
      expect(reports.items.map((r) => r.id)).toEqual([0]);
      expect((await client.attestors()).items).toHaveLength(2);
      expect((await client.classes({ target: TARGET })).items).toHaveLength(2);
      expect((await client.freezes({ target: TARGET })).items.at(-1)?.frozen_after).toBe(false);
      expect((await client.heartbeats({ target: TARGET })).items).toHaveLength(1);
      expect((await client.coverages()).items).toEqual([]);
      expect((await client.claims()).items).toEqual([]);
      expect((await client.events({ event: "target_classified" })).items).toHaveLength(2);
    } finally {
      await s.close();
    }
  });
});

describe("rebuilding the derived tables from the raw ones", () => {
  it("a store made before these tables existed gets them from its raw events on the next open, equal to a store that read them live", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aruna-idx-")), "store.db");
    const live = load(REGISTRY, registryEvents, undefined, openStore(path));
    // The pool's story follows the registry's, shifted so the blocks stay consecutive.
    const shift = registryEvents[registryEvents.length - 1].block + 1 - poolEvents[0].block;
    load(POOL, poolEvents.map((e) => ({ ...e, block: e.block + shift })), undefined, live);
    const expected = live.export();
    live.close();

    // What an older indexer left behind: the raw events, and none of the new derived tables.
    const raw = new DatabaseSync(path);
    for (const t of ["coverages", "claims", "reports", "freezes", "heartbeats", "attestors", "assignments", "classes"]) raw.exec(`DROP TABLE ${t}`);
    raw.exec("DELETE FROM meta WHERE key = 'derived_version'");
    raw.close();

    const reopened = openStore(path);
    expect(reopened.export()).toBe(expected);
    expect(get(reopened, "/v1/reports").body.items).toHaveLength(2);
    reopened.close();
  });

  it("an empty store just records the version, and opening twice changes nothing", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aruna-idx-")), "store.db");
    const a = openStore(path);
    a.close();
    const b = openStore(path);
    expect(b.export()).toBe(openStore(":memory:").export());
    b.close();
  });
});

describe("constants copied from the contracts", () => {
  it("equal contracts/common/src/params.rs", () => {
    const src = readFileSync(new URL("../../../contracts/common/src/params.rs", import.meta.url), "utf8");
    const num = (name: string) => Number(src.match(new RegExp(`pub const ${name}: [a-z0-9]+ = ([0-9_]+);`))![1].replace(/_/g, ""));
    expect(CHALLENGE_WINDOW_BLOCKS).toBe(num("CHALLENGE_WINDOW_BLOCKS"));
    expect(HEARTBEAT_STALE_BLOCKS).toBe(num("HEARTBEAT_STALE_BLOCKS"));
  });
});
