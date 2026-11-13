import type { Classification } from "@aruna/classifier-core";
import type { ClassRecord, DriftReport } from "@aruna/sdk/coverage";
import { describe, expect, it } from "vitest";
import { gatherCandidates, indexerReportTargets, runOnce, type KeeperChain } from "../src/run.js";

type Cls = ClassRecord["class"];
const rec = (over: Partial<ClassRecord> = {}): ClassRecord => ({ class: "global_by_account", classified_at_block: 100, classifier: "reg.testnet", evidence_hash: "h0", frozen: true, ...over });
const rep = (state: DriftReport["state"], reportedAt = 200, id = 2): DriftReport => ({ id, state, reported_at_block: reportedAt, report: {} as DriftReport["report"] });
const classification = (cls: Cls, hash = "NEW"): Classification => ({
  class: cls,
  evidence: {
    accountId: "x",
    checkedAtBlock: 5000,
    codeRef: { kind: "global_account", ownerAccount: "owner.testnet" },
    fullAccessKeyCount: 0,
    functionCallKeyCount: 0,
    monitoredCodeHash: null,
    resolvedCodeHash: hash,
    upgradeImports: [],
    mutabilityBasis: "global_owner",
    wasmParsed: true,
  },
});

/** A registry that follows the real rules: a lift needs a final report, and set_class stamps a newer block and keeps `frozen`. */
function world(init: Record<string, { record: ClassRecord | null; report: DriftReport | null }>, opts: { failLift?: number; failSet?: number } = {}) {
  const s = structuredClone(init);
  const calls: string[] = [];
  let block = 1000;
  let failLift = opts.failLift ?? 0;
  let failSet = opts.failSet ?? 0;
  const chain: KeeperChain = {
    classOf: async (t) => s[t]?.record ?? null,
    latestReport: async (t) => s[t]?.report ?? null,
    liftFreeze: async (t) => {
      calls.push(`lift ${t}`);
      if (failLift-- > 0) throw new Error("rpc down");
      const e = s[t]!;
      if (e.report?.state !== "verified" && e.report?.state !== "rejected") throw new Error("ARUNA_REPORT_NOT_FINAL");
      e.record!.frozen = false;
      return "tx-lift";
    },
    setClass: async (a) => {
      calls.push(`set_class ${a.target} ${a.class} ${a.resolved_code_hash}`);
      if (failSet-- > 0) throw new Error("rpc down");
      const e = s[a.target]!;
      e.record = { ...e.record!, class: a.class, evidence_hash: a.evidence_hash, classified_at_block: ++block };
      return "tx-set";
    },
  };
  return { chain, calls, state: s };
}
const classifyAs = (classes: Record<string, Cls | Error>) => async (t: string) => {
  const c = classes[t];
  if (c instanceof Error || c === undefined) throw c ?? new Error("no classification for " + t);
  return classification(c);
};
const quiet = () => {};

describe("runOnce", () => {
  it("Covers AE5. lifts, then writes, a frozen target whose report is Verified and whose class did not worsen", async () => {
    const w = world({ "drift.testnet": { record: rec(), report: rep("verified") } });
    const out = await runOnce({ chain: w.chain, classify: classifyAs({ "drift.testnet": "global_by_account" }), targets: ["drift.testnet"], log: quiet });
    expect(w.calls).toEqual(["lift drift.testnet", "set_class drift.testnet global_by_account NEW"]);
    expect(out[0]).toMatchObject({ target: "drift.testnet", result: "released" });
    expect(w.state["drift.testnet"]!.record).toMatchObject({ frozen: false, class: "global_by_account" });
  });

  it("lifts and writes after a Rejected report with an unchanged class", async () => {
    const w = world({ "t.testnet": { record: rec(), report: rep("rejected") } });
    await runOnce({ chain: w.chain, classify: classifyAs({ "t.testnet": "global_by_account" }), targets: ["t.testnet"], log: quiet });
    expect(w.calls).toEqual(["lift t.testnet", "set_class t.testnet global_by_account NEW"]);
  });

  it("Covers AE6. writes the riskier class, leaves the freeze, and logs the target, both classes and the report", async () => {
    const lines: string[] = [];
    const w = world({ "t.testnet": { record: rec({ class: "immutable_verified" }), report: rep("verified", 200, 9) } });
    const out = await runOnce({ chain: w.chain, classify: classifyAs({ "t.testnet": "local_upgradeable" }), targets: ["t.testnet"], log: (m) => lines.push(m) });
    expect(w.calls).toEqual(["set_class t.testnet local_upgradeable NEW"]);
    expect(out[0]!.result).toBe("held");
    expect(w.state["t.testnet"]!.record!.frozen).toBe(true);
    const held = lines.find((l) => /HELD/.test(l))!;
    expect(held).toMatch(/t\.testnet/);
    expect(held).toMatch(/immutable_verified/);
    expect(held).toMatch(/local_upgradeable/);
    expect(held).toMatch(/report 9/);
  });

  it("Covers AE7. sends nothing for a target whose latest report is Disputed or Pending", async () => {
    const w = world({ "a.testnet": { record: rec(), report: rep("disputed") }, "b.testnet": { record: rec(), report: rep("pending") } });
    const out = await runOnce({ chain: w.chain, classify: classifyAs({}), targets: ["a.testnet", "b.testnet"], log: quiet });
    expect(w.calls).toEqual([]);
    expect(out.map((o) => o.result)).toEqual(["skipped", "skipped"]);
  });

  it("Covers AE8. sends nothing the second time: after a release the record is newer than the report", async () => {
    const w = world({ "t.testnet": { record: rec(), report: rep("verified") } });
    const deps = { chain: w.chain, classify: classifyAs({ "t.testnet": "global_by_account" as Cls }), targets: ["t.testnet"], log: quiet };
    await runOnce(deps);
    const before = w.calls.length;
    const again = await runOnce(deps);
    expect(w.calls.length).toBe(before);
    expect(again[0]).toMatchObject({ result: "skipped", reason: "handled" });
  });

  it("only writes a target that is no longer frozen but whose record is older than its final report", async () => {
    const w = world({ "t.testnet": { record: rec({ frozen: false }), report: rep("verified") } });
    await runOnce({ chain: w.chain, classify: classifyAs({ "t.testnet": "global_by_account" }), targets: ["t.testnet"], log: quiet });
    expect(w.calls).toEqual(["set_class t.testnet global_by_account NEW"]);
  });

  it("skips a target with no class record or no report, without classifying it", async () => {
    const w = world({ "norecord.testnet": { record: null, report: rep("verified") }, "noreport.testnet": { record: rec(), report: null } });
    const out = await runOnce({ chain: w.chain, classify: classifyAs({}), targets: ["norecord.testnet", "noreport.testnet"], log: quiet });
    expect(w.calls).toEqual([]);
    expect(out.map((o) => o.reason)).toEqual(["no_record", "no_report"]);
  });

  it("sends no set_class in a run where the lift failed, and the next run retries the lift", async () => {
    const w = world({ "t.testnet": { record: rec(), report: rep("verified") } }, { failLift: 1 });
    const deps = { chain: w.chain, classify: classifyAs({ "t.testnet": "global_by_account" as Cls }), targets: ["t.testnet"], log: quiet };
    const first = await runOnce(deps);
    expect(w.calls).toEqual(["lift t.testnet"]);
    expect(first[0]!.result).toBe("failed");
    await runOnce(deps);
    expect(w.calls).toEqual(["lift t.testnet", "lift t.testnet", "set_class t.testnet global_by_account NEW"]);
  });

  it("sends nothing for a target whose classification could not be read, and goes on to the next", async () => {
    const w = world({ "bad.testnet": { record: rec(), report: rep("verified") }, "ok.testnet": { record: rec(), report: rep("verified") } });
    const out = await runOnce({
      chain: w.chain,
      classify: classifyAs({ "bad.testnet": new Error("rpc 429"), "ok.testnet": "global_by_account" }),
      targets: ["bad.testnet", "ok.testnet"],
      log: quiet,
    });
    expect(out.map((o) => o.result)).toEqual(["failed", "released"]);
    expect(w.calls.every((c) => !c.includes("bad.testnet"))).toBe(true);
  });
});

describe("candidates", () => {
  it("falls back to the seed list, and the run completes, when the indexer cannot be read", async () => {
    const lines: string[] = [];
    const targets = await gatherCandidates({ seed: ["seed.testnet"], reportTargets: async () => Promise.reject(new Error("indexer down")), log: (m) => lines.push(m) });
    expect(targets).toEqual(["seed.testnet"]);
    expect(lines.join("\n")).toMatch(/indexer down/);
    const w = world({ "seed.testnet": { record: rec(), report: rep("verified") } });
    await runOnce({ chain: w.chain, classify: classifyAs({ "seed.testnet": "global_by_account" }), targets, log: quiet });
    expect(w.calls).toEqual(["lift seed.testnet", "set_class seed.testnet global_by_account NEW"]);
  });

  it("finishes, on the next run, a release whose lift landed and whose write failed, for a target that is not in the seed list", async () => {
    const w = world({ "other.testnet": { record: rec(), report: rep("verified") } }, { failSet: 1 });
    const gather = () => gatherCandidates({ seed: [], reportTargets: async () => ["other.testnet"], log: quiet });
    const run = async () => runOnce({ chain: w.chain, classify: classifyAs({ "other.testnet": "global_by_account" }), targets: await gather(), log: quiet });
    await run();
    expect(w.state["other.testnet"]!.record).toMatchObject({ frozen: false, evidence_hash: "h0" });
    await run();
    expect(w.calls.at(-1)).toBe("set_class other.testnet global_by_account NEW");
    expect(w.state["other.testnet"]!.record!.evidence_hash).not.toBe("h0");
  });

  it("merges the seed and the indexer's targets without repeats", async () => {
    expect(await gatherCandidates({ seed: ["a.testnet", "b.testnet"], reportTargets: async () => ["b.testnet", "c.testnet"], log: quiet })).toEqual(["a.testnet", "b.testnet", "c.testnet"]);
  });
});

describe("indexerReportTargets: the real indexer client against a fake server", () => {
  it("follows the pages and returns each target with a report once", async () => {
    const urls: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      urls.push(String(url));
      const second = String(url).includes("after=5");
      const items = second ? [{ target: "b.testnet" }, { target: "c.testnet" }] : [{ target: "a.testnet" }, { target: "b.testnet" }];
      return new Response(JSON.stringify({ last_indexed_block: 10, items, next_after: second ? null : 5 }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const got = await indexerReportTargets({ baseUrl: "https://idx.example", registry: "registry2.testnet", fetch: fake })();
    expect(got).toEqual(["a.testnet", "b.testnet", "c.testnet"]);
    expect(urls[0]).toContain("/v1/reports");
    expect(urls[0]).toContain("registry=registry2.testnet");
    expect(urls[1]).toContain("after=5");
  });
});
