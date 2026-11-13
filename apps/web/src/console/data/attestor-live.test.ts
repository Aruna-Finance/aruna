import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HEARTBEAT_STALE_BLOCKS, attestorState, groupByAttestor, heartbeatAge, readAttestor } from "./attestor-live";
import type { RegistryTarget } from "./registry-live";

const rec = (o: Partial<{ bond: string; last_heartbeat: number }> = {}) => ({ signing_key: "ed25519:K", bond: "1", last_heartbeat: 1000, registered_at: 1, ...o });
const row = (target: string, attestor: string | null): RegistryTarget => ({ target, record: null, attestor, heartbeatFresh: false, latest: null });

describe("heartbeat bound", () => {
  it("matches contracts/common/src/params.rs", () => {
    const src = readFileSync(join(process.cwd(), "../../contracts/common/src/params.rs"), "utf8");
    expect(src).toMatch(new RegExp(`HEARTBEAT_STALE_BLOCKS: u64 = ${HEARTBEAT_STALE_BLOCKS};`));
  });
});

describe("attestorState", () => {
  it("applies the registry's own test: a live bond and a heartbeat within the bound", () => {
    expect(attestorState(rec(), 1000 + HEARTBEAT_STALE_BLOCKS)).toBe("alive");
    expect(attestorState(rec(), 1001 + HEARTBEAT_STALE_BLOCKS)).toBe("stale");
    expect(attestorState(rec({ bond: "0" }), 1001)).toBe("no_bond");
    expect(attestorState(null, 1001)).toBe("unknown");
  });
  it("counts the age of a heartbeat in blocks and never below zero", () => {
    expect(heartbeatAge(rec(), 1500)).toBe(500);
    expect(heartbeatAge(rec(), 900)).toBe(0);
  });
});

describe("groupByAttestor", () => {
  it("groups targets by attestor and keeps the unassigned apart", () => {
    const { groups, unassigned } = groupByAttestor([row("a", "x"), row("b", null), row("c", "x"), row("d", "y")]);
    expect(groups.map((g) => [g.attestor, g.targets.map((t) => t.target)])).toEqual([["x", ["a", "c"]], ["y", ["d"]]]);
    expect(unassigned.map((t) => t.target)).toEqual(["b"]);
  });
});

describe("readAttestor", () => {
  it("reads get_attestor and keeps a missing record as null", async () => {
    const reads = {
      async view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
        expect([contract, method, args.attestor]).toEqual(["reg.testnet", "get_attestor", "a.testnet"]);
        return null as T;
      },
    };
    expect(await readAttestor(reads, "a.testnet", "reg.testnet")).toEqual({ id: "a.testnet", record: null });
  });
});
