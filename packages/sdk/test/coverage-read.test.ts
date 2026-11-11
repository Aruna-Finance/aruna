import { describe, expect, it } from "vitest";
import { fetchViewTransport, Pool, Registry, type ReadTransport } from "../src/coverage/index.js";
import { ArunaRpcError } from "../src/vault/transport.js";

type Handler = (contract: string, method: string, args: Record<string, unknown>) => unknown;
const fake = (h: Handler): ReadTransport & { calls: [string, string, Record<string, unknown>][] } => {
  const calls: [string, string, Record<string, unknown>][] = [];
  return { calls, view: async <T>(c: string, m: string, a: Record<string, unknown>) => (calls.push([c, m, a]), h(c, m, a) as T) };
};
const cov = (id: number, owner: string, vault: string) => ({ id, owner, vault });

describe("Registry (keyless reads)", () => {
  it("classOf returns the record, and null for a target never classified", async () => {
    const t = fake((_c, _m, a) => (a.target === "known.testnet" ? { class: "global_by_account", resolved_code_hash: "H", upgrade_authority: "o.testnet" } : null));
    const r = new Registry({ registry: "registry2.x.testnet", transport: t });
    expect((await r.classOf("known.testnet"))?.class).toBe("global_by_account");
    expect(await r.classOf("other.testnet")).toBeNull();
    expect(t.calls[0]).toEqual(["registry2.x.testnet", "get_class", { target: "known.testnet" }]);
  });

  it("latestReport and report read the contract's views with the right arguments", async () => {
    const t = fake(() => ({ id: 3, state: "Verified" }));
    const r = new Registry({ registry: "reg", transport: t });
    expect((await r.latestReport("t.testnet"))?.state).toBe("Verified");
    await r.report(3);
    expect(t.calls.map((c) => [c[1], c[2]])).toEqual([["latest_report", { target: "t.testnet" }], ["get_report", { id: 3 }]]);
  });
});

describe("Pool (keyless reads)", () => {
  it("coverages({ owner }) returns only that owner's, in id order", async () => {
    const all = [cov(0, "a.testnet", "v1"), cov(1, "b.testnet", "v1"), cov(2, "a.testnet", "v2")];
    const t = fake((_c, m, a) => (m === "coverage_count" ? all.length : m === "get_coverage" ? all[a.id as number] : null));
    const p = new Pool({ pool: "pool", transport: t });
    expect((await p.coverages({ owner: "a.testnet" })).map((c) => c.id)).toEqual([0, 2]);
    expect((await p.coverages({ vault: "v1" })).map((c) => c.id)).toEqual([0, 1]);
  });

  it("an empty pool makes one view call, not one per id", async () => {
    const t = fake((_c, m) => (m === "coverage_count" ? 0 : null));
    expect(await new Pool({ pool: "pool", transport: t }).coverages({ owner: "a.testnet" })).toEqual([]);
    expect(t.calls).toHaveLength(1);
  });

  it("scans in batches larger than one and still returns everything", async () => {
    const all = Array.from({ length: 25 }, (_, i) => cov(i, i % 5 === 0 ? "a.testnet" : "z.testnet", "v"));
    const t = fake((_c, m, a) => (m === "coverage_count" ? all.length : all[a.id as number]));
    expect((await new Pool({ pool: "pool", transport: t }).coverages({ owner: "a.testnet" })).map((c) => c.id)).toEqual([0, 5, 10, 15, 20]);
  });

  it("a failed read throws and never returns a partial list", async () => {
    const t = fake((_c, m, a) => {
      if (m === "coverage_count") return 3;
      if (a.id === 1) throw new ArunaRpcError("node down");
      return cov(a.id as number, "a.testnet", "v");
    });
    await expect(new Pool({ pool: "pool", transport: t }).coverages({ owner: "a.testnet" })).rejects.toBeInstanceOf(ArunaRpcError);
  });

  it("books and shares name the token the way the contract does", async () => {
    const t = fake(() => ({}));
    const p = new Pool({ pool: "pool", transport: t });
    await p.book("near");
    await p.book("usdc.x.testnet");
    await p.shares("u.testnet", "usdc.x.testnet");
    expect(t.calls.map((c) => c[2])).toEqual([{ token: "near" }, { token: { ft: "usdc.x.testnet" } }, { underwriter: "u.testnet", token: { ft: "usdc.x.testnet" } }]);
  });
});

describe("fetchViewTransport", () => {
  const ok = (value: unknown) => ({ json: async () => ({ result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) } }) });

  it("decodes a view result and sends no signature", async () => {
    let sent = "";
    const t = fetchViewTransport({ endpoints: ["https://a"], fetch: (async (_u: string, init: { body: string }) => ((sent = init.body), ok({ n: 1 }))) as never });
    expect(await t.view("c", "m", { x: 1 })).toEqual({ n: 1 });
    expect(JSON.parse(sent).params.request_type).toBe("call_function");
  });

  it("falls over to the next endpoint on a transport failure", async () => {
    let n = 0;
    const t = fetchViewTransport({ endpoints: ["https://a", "https://b"], fetch: (async () => (++n === 1 ? Promise.reject(new Error("down")) : ok(7))) as never });
    expect(await t.view("c", "m", {})).toBe(7);
  });

  it("a contract error is thrown at once, not retried on another endpoint", async () => {
    let n = 0;
    const t = fetchViewTransport({ endpoints: ["https://a", "https://b"], fetch: (async () => (n++, { json: async () => ({ result: { error: "MethodNotFound" } }) })) as never });
    await expect(t.view("c", "m", {})).rejects.toBeInstanceOf(ArunaRpcError);
    expect(n).toBe(1);
  });

  it("throws ArunaRpcError naming every endpoint when none answers", async () => {
    const t = fetchViewTransport({ endpoints: ["https://a", "https://b"], fetch: (async () => Promise.reject(new Error("down"))) as never });
    await expect(t.view("c", "m", {})).rejects.toThrow(/https:\/\/a.*https:\/\/b/s);
  });
});
