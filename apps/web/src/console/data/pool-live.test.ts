import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Book, Coverage } from "@aruna/sdk/coverage";
import { describe, expect, it } from "vitest";
import { CONCENTRATION_BPS, K_X100, bookFigures, bpsText, groupRows, stageCounts, tokensOf } from "./pool-live";

const book = (o: Partial<Book> = {}): Book => ({ capital: "1000", total_shares: "1000", total_limits: "2000", locked_until: 500, ...o });
const cov = (o: Partial<Coverage> & { id: number }): Coverage =>
  ({
    owner: "o.testnet",
    vault: "v.testnet",
    agent: "ed25519:x",
    target: "t.testnet",
    token: "near",
    limit: "100",
    payout_ratio_bps: 8000,
    premium_paid: "1",
    class: "local_upgradeable",
    code_hash: "H1",
    upgrade_authority: "auth.testnet",
    start_block: 1,
    waiting_period_ends: 2,
    end_block: 3,
    policy_version: 0,
    daily_cap_priced: "1",
    paid_out: "0",
    claims: [],
    claim_in_flight: false,
    claim_started_at: 0,
    paid_through_block: 1,
    released: false,
    ...o,
  }) as Coverage;

describe("pool rules", () => {
  it("match contracts/common/src/params.rs", () => {
    const src = readFileSync(join(process.cwd(), "../../contracts/common/src/params.rs"), "utf8");
    expect(src).toMatch(new RegExp(`K_X100: u128 = ${K_X100};`));
    expect(src).toMatch(new RegExp(`CONCENTRATION_BPS: u128 = ${CONCENTRATION_BPS.toString().replace(/(\d)(?=(\d{3})+$)/, "$1_")};`));
  });
});

describe("bookFigures", () => {
  it("computes k x capital, headroom and the group cap", () => {
    const f = bookFigures("near", book(), 100);
    expect(f.maxLimits).toBe(5000n);
    expect(f.headroom).toBe(3000n);
    expect(f.groupCap).toBe(2000n);
    expect(f.locked).toBe(true);
    expect(f.blocksToUnlock).toBe(400);
  });
  it("has no headroom when full and is unlocked after the lock block", () => {
    const f = bookFigures("near", book({ total_limits: "9000" }), 600);
    expect(f.headroom).toBe(0n);
    expect(f.locked).toBe(false);
    expect(f.blocksToUnlock).toBe(0);
  });
});

describe("groupRows", () => {
  const list = [
    cov({ id: 0, limit: "100", code_hash: "A", target: "t1" }),
    cov({ id: 1, limit: "300", paid_out: "80", code_hash: "A", target: "t2" }),
    cov({ id: 2, limit: "50", code_hash: "B" }),
    cov({ id: 3, limit: "999", code_hash: "A", released: true }),
    cov({ id: 4, limit: "70", code_hash: "A", token: { ft: "usdc.testnet" } }),
  ];
  it("sums remaining limits per group, leaves out released and other tokens, largest first", () => {
    const rows = groupRows(list, "code_hash", "near", 1000n);
    expect(rows.map((r) => [r.key, r.limit, r.coverages])).toEqual([["A", 320n, 2], ["B", 50n, 1]]);
    expect(rows[0].usedBps).toBe(3200);
    expect(rows[0].targets).toEqual(["t1", "t2"]);
  });
  it("groups by upgrade authority", () => {
    expect(groupRows(list, "upgrade_authority", "near", 1000n)).toHaveLength(1);
  });
});

describe("stageCounts and tokensOf", () => {
  const list = [cov({ id: 0 }), cov({ id: 1, paid_out: "5" }), cov({ id: 2, claim_in_flight: true }), cov({ id: 3, released: true }), cov({ id: 4, token: { ft: "u.testnet" } })];
  it("counts by stage for one token", () => {
    expect(stageCounts(list, "near", 2)).toEqual({ active: 1, ended: 0, claimInFlight: 1, paid: 1, released: 1 });
    expect(stageCounts(list, "near", 3).ended).toBe(1);
  });
  it("lists near first, then each token once", () => {
    expect(tokensOf(list)).toEqual(["near", "u.testnet"]);
    expect(bpsText(3200)).toBe("32.0%");
  });
});
