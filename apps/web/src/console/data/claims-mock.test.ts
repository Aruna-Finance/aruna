import { describe, expect, it } from "vitest";
import { DAY } from "./coverage";
import { createClaimsStore } from "./claims-mock";

describe("claims store (mock)", () => {
  it("starts with no reports", () => {
    expect(createClaimsStore().get().reports).toEqual([]);
  });

  it("opens a report with one claim per policy on the target", () => {
    const s = createClaimsStore();
    s.reportDrift("dex.testnet");
    const st = s.get();
    expect(st.reports[0].status).toBe("challenge_window");
    expect(st.claims).toHaveLength(3);
    expect(st.claims.every((c) => c.status === "challenge_window")).toBe(true);
  });

  it("pays claims that meet every condition once the window closes", () => {
    const s = createClaimsStore();
    s.reportDrift("dex.testnet");
    s.advance(3 * DAY);
    const st = s.get();
    expect(st.reports[0].status).toBe("paid");
    const own = st.claims.find((c) => c.agent === "rebalancer")!;
    expect(own.status).toBe("paid");
    expect(own.payout).toBe(Math.min(own.exposure * 0.8, own.limit));
  });

  it("holds payout while disputed, and rejects when the arbiter rejects", () => {
    const s = createClaimsStore();
    s.reportDrift("dex.testnet");
    s.conflict("r-1", "attestor-2.testnet", "abc");
    s.advance(3 * DAY);
    expect(s.get().reports[0].status).toBe("disputed");
    s.rule("r-1", false);
    expect(s.get().reports[0].status).toBe("rejected");
    expect(s.get().claims.every((c) => c.payout === 0)).toBe(true);
  });

  it("refuses a conflict from the same attestor", () => {
    const s = createClaimsStore();
    s.reportDrift("dex.testnet");
    expect(() => s.conflict("r-1", "attestor-1.testnet", "abc")).toThrow(/ARUNA_SAME_ATTESTOR/);
  });
});
