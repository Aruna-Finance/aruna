import { describe, expect, it } from "vitest";
import type { Coverage } from "@aruna/sdk/coverage";
import { amountText, coverageRows, stageOf, tokenOf } from "./coverage-live";

const cov = (o: Partial<Coverage> = {}): Coverage => ({
  id: 0, owner: "o.testnet", vault: "v.factory2.arunafi.testnet", agent: "ed25519:A", target: "drift-target.arunafi.testnet", token: "near",
  limit: "1000000000000000000000000", payout_ratio_bps: 8000, premium_paid: "2773333333333333333332", class: "global_by_account", code_hash: "H",
  upgrade_authority: "u", start_block: 100, waiting_period_ends: 200, end_block: 1000, policy_version: 1, daily_cap_priced: "1", paid_out: "0",
  claims: [], claim_in_flight: false, claim_started_at: 0, paid_through_block: 100, ...o,
});

describe("coverage stage", () => {
  it("is waiting until the waiting period ends, then active until the end block", () => {
    expect(stageOf(cov(), 199)).toBe("waiting");
    expect(stageOf(cov(), 200)).toBe("active");
    expect(stageOf(cov(), 999)).toBe("active");
    expect(stageOf(cov(), 1000)).toBe("ended");
  });
  it("shows a payout, a claim in progress and a release as what happened, whatever the calendar says", () => {
    expect(stageOf(cov({ paid_out: "5" }), 150)).toBe("paid");
    expect(stageOf(cov({ claim_in_flight: true, paid_out: "5" }), 500)).toBe("claim_in_flight");
    expect(stageOf(cov({ released: true, claim_in_flight: true }), 500)).toBe("released");
  });
});

describe("coverage rows", () => {
  it("keeps the pool's numbers as strings and names the token", () => {
    const [r] = coverageRows([cov(), cov({ id: 1, token: { ft: "usdc.testnet" } })], 300);
    expect(r).toMatchObject({ id: 0, token: "near", limit: "1000000000000000000000000", payoutRatioBps: 8000, stage: "active" });
    expect(coverageRows([cov({ token: { ft: "usdc.testnet" } })], 300)[0].token).toBe("usdc.testnet");
    expect(tokenOf("near")).toBe("near");
  });
  it("writes NEAR in whole units and a token amount in its smallest unit with the token named", () => {
    expect(amountText("near", "1000000000000000000000000")).toBe("1 NEAR");
    expect(amountText("usdc.testnet", "10000000")).toContain("usdc.testnet");
  });
});
