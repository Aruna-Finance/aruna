import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadState, saveState } from "../src/state.js";
import { indexerAssignments, resolveTargets } from "../src/targets.js";
import { reportFor, type Observation } from "../src/watch.js";

const ME = "attestor-a.testnet";
const base = (over: Partial<Parameters<typeof resolveTargets>[0]> = {}): Parameters<typeof resolveTargets>[0] => ({
  attestor: ME,
  seed: [],
  last: [],
  assignedAttestor: async () => ME,
  log: () => {},
  ...over,
});

describe("resolveTargets: the targets this attestor watches", () => {
  it("Covers AE2. adds a target the indexer lists once the registry confirms it is assigned here", async () => {
    const got = await resolveTargets(base({ seed: ["swap.testnet"], last: ["swap.testnet"], assigned: async () => ["swap.testnet", "new.testnet"] }));
    expect(got).toEqual(["swap.testnet", "new.testnet"]);
  });

  it("drops a seed target the registry assigns to another attestor, and says so", async () => {
    const lines: string[] = [];
    const got = await resolveTargets(
      base({ seed: ["mine.testnet", "theirs.testnet"], assignedAttestor: async (t) => (t === "theirs.testnet" ? "attestor-b.testnet" : ME), log: (m) => lines.push(m) }),
    );
    expect(got).toEqual(["mine.testnet"]);
    expect(lines.join("\n")).toMatch(/theirs\.testnet.*attestor-b\.testnet/);
  });

  it("drops a target the registry has no attestor for", async () => {
    const got = await resolveTargets(base({ seed: ["orphan.testnet"], assignedAttestor: async () => null }));
    expect(got).toEqual([]);
  });

  it("Covers AE3. keeps the last confirmed list, plus the seed, when the indexer cannot be reached", async () => {
    const lines: string[] = [];
    const got = await resolveTargets(
      base({ seed: ["a.testnet"], last: ["a.testnet", "b.testnet"], assigned: async () => Promise.reject(new Error("indexer down")), log: (m) => lines.push(m) }),
    );
    expect(got).toEqual(["a.testnet", "b.testnet"]);
    expect(lines.join("\n")).toMatch(/indexer down/);
  });

  it("with no indexer configured, watches the seed and the last confirmed list", async () => {
    const got = await resolveTargets(base({ seed: ["a.testnet"], last: ["b.testnet"] }));
    expect(got).toEqual(["a.testnet", "b.testnet"]);
  });

  it("watches nothing when there is no seed, no last list and no assignments", async () => {
    expect(await resolveTargets(base({ assigned: async () => [] }))).toEqual([]);
  });

  it("keeps a target it already watches when the registry read fails, and skips one it has never confirmed", async () => {
    const got = await resolveTargets(
      base({ seed: ["known.testnet", "fresh.testnet"], last: ["known.testnet"], assignedAttestor: async () => Promise.reject(new Error("rpc 429")) }),
    );
    expect(got).toEqual(["known.testnet"]);
  });
});

describe("indexerAssignments: the real indexer client against a fake server", () => {
  const page = (items: unknown[]) => new Response(JSON.stringify({ last_indexed_block: 10, items, next_after: null }), { headers: { "content-type": "application/json" } });

  it("asks /v1/attestors for this attestor and registry and returns its targets", async () => {
    const urls: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return page([
        { registry: "registry2.testnet", attestor: ME, targets: ["a.testnet", "b.testnet"] },
        { registry: "registry2.testnet", attestor: "other.testnet", targets: ["c.testnet"] },
      ]);
    }) as typeof fetch;
    const got = await indexerAssignments({ baseUrl: "https://idx.example", attestor: ME, registry: "registry2.testnet", fetch: fake })();
    expect(got).toEqual(["a.testnet", "b.testnet"]);
    expect(urls[0]).toMatch(/^https:\/\/idx\.example\/v1\/attestors\?/);
    expect(urls[0]).toContain(`attestor=${ME}`);
  });

  it("rejects when the indexer cannot be reached, so the caller keeps its last list", async () => {
    const down = (async () => Promise.reject(new Error("connect ECONNREFUSED"))) as typeof fetch;
    await expect(indexerAssignments({ baseUrl: "https://idx.example", attestor: ME, registry: "r.testnet", fetch: down })()).rejects.toThrow();
  });
});

describe("state across a restart", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "aruna-attestor-"));
    dirs.push(d);
    return d;
  };
  const obs = (block: number, resolvedHash: string): Observation => ({ target: "t.testnet", block, codeRef: { kind: "global_account", ownerAccount: "o.testnet" }, resolvedHash });

  it("Covers AE4. reports a change made while the daemon was down, from the observation it saved before", () => {
    const dir = tmp();
    saveState(ME, { nonce: 7, observations: { "t.testnet": obs(100, "V1") }, targets: ["t.testnet"] }, dir);
    // The restart: a fresh read of the same directory.
    const state = loadState(ME, dir);
    expect(state.targets).toEqual(["t.testnet"]);
    const report = reportFor(state.observations["t.testnet"]!, obs(160, "V2"), ME, state.nonce + 1, 600);
    expect(report).toMatchObject({ target: "t.testnet", before_resolved_hash: "V1", after_resolved_hash: "V2", channel: "deploy_global_contract", nonce: 8 });
  });

  it("starts empty, with a fresh nonce, when no state was ever saved", () => {
    const state = loadState(ME, tmp());
    expect(state.observations).toEqual({});
    expect(state.nonce).toBeGreaterThan(0);
  });
});
