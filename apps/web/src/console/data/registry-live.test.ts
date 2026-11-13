import { describe, expect, it } from "vitest";
import { agreement, candidateTargets, codeChange, freshnessOf, readRegistryTarget, targetIdProblem } from "./registry-live";
import { MAX_CLASS_AGE_BLOCKS } from "./types";

describe("readRegistryTarget", () => {
  it("asks the four registry views for the target and keeps a null record as null", async () => {
    const calls: string[] = [];
    const reads = {
      async view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
        calls.push(`${contract}.${method}.${String(args.target)}`);
        const out: Record<string, unknown> = { get_class: null, assigned_attestor: null, heartbeat_fresh: false, latest_report: null };
        return out[method] as T;
      },
    };
    const r = await readRegistryTarget(reads, "t.testnet", "reg.testnet");
    expect(calls.sort()).toEqual(["reg.testnet.assigned_attestor.t.testnet", "reg.testnet.get_class.t.testnet", "reg.testnet.heartbeat_fresh.t.testnet", "reg.testnet.latest_report.t.testnet"]);
    expect(r).toEqual({ target: "t.testnet", record: null, attestor: null, heartbeatFresh: false, latest: null });
  });

  it("fails as a whole when one view fails, never a partial record", async () => {
    const reads = {
      async view<T>(_c: string, method: string): Promise<T> {
        if (method === "heartbeat_fresh") throw new Error("rpc down");
        return null as T;
      },
    };
    await expect(readRegistryTarget(reads, "t.testnet")).rejects.toThrow("rpc down");
  });
});

describe("agreement", () => {
  it("compares the recorded class with a fresh run", () => {
    expect(agreement("local_upgradeable", "local_upgradeable")).toBe("agree");
    expect(agreement("immutable_verified", "local_upgradeable")).toBe("differ");
    expect(agreement(null, "unknown")).toBe("not_recorded");
    expect(agreement("unknown", null)).toBe("live_unavailable");
  });
});

describe("codeChange", () => {
  it("compares the recorded code hash with the fresh one", () => {
    expect(codeChange("A", "A")).toBe("same");
    expect(codeChange("A", "B")).toBe("changed");
    expect(codeChange(null, "B")).toBe("unknown");
    expect(codeChange("A", undefined)).toBe("unknown");
  });
});

describe("freshnessOf", () => {
  it("is stale only past the vault's bound", () => {
    expect(freshnessOf({ classified_at_block: 1000 }, 1000 + MAX_CLASS_AGE_BLOCKS)).toEqual({ age: MAX_CLASS_AGE_BLOCKS, stale: false });
    expect(freshnessOf({ classified_at_block: 1000 }, 1001 + MAX_CLASS_AGE_BLOCKS).stale).toBe(true);
    expect(freshnessOf({ classified_at_block: 1000 }, 900).age).toBe(0);
  });
});

describe("candidateTargets and targetIdProblem", () => {
  it("lists seeded targets first and each target once", () => {
    expect(candidateTargets(["a.testnet", "b.testnet"], ["b.testnet", "c.testnet", "c.testnet"])).toEqual(["a.testnet", "b.testnet", "c.testnet"]);
  });
  it("accepts account ids and refuses the rest", () => {
    expect(targetIdProblem("drift-target.arunafi.testnet")).toBeNull();
    expect(targetIdProblem("Bad Name")).not.toBeNull();
    expect(targetIdProblem("")).not.toBeNull();
  });
});
