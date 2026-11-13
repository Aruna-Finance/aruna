import type { Book, Coverage } from "@aruna/sdk/coverage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PoolLive } from "../usePoolLive";
import { PoolView } from "./Pool";

const YOCTO = 10n ** 24n;
const book: Book = { capital: (10n * YOCTO).toString(), total_shares: "1000", total_limits: (30n * YOCTO).toString(), locked_until: 900 };
const cov = (id: number, limit: bigint, hash: string): Coverage =>
  ({
    id, owner: "o.testnet", vault: "v.testnet", agent: "ed25519:x", target: `t${id}.testnet`, token: "near", limit: limit.toString(), payout_ratio_bps: 8000,
    premium_paid: "1", class: "local_upgradeable", code_hash: hash, upgrade_authority: "auth.testnet", start_block: 1, waiting_period_ends: 2, end_block: 3,
    policy_version: 0, daily_cap_priced: "1", paid_out: "0", claims: [], claim_in_flight: false, claim_started_at: 0, paid_through_block: 1, released: false,
  }) as Coverage;

const ok: PoolLive = {
  state: "ok",
  head: 500,
  coverages: [cov(0, 15n * YOCTO, "HASH_A"), cov(1, 5n * YOCTO, "HASH_B")],
  books: new Map([["near", book]]),
  shares: new Map([["near", "250"]]),
};

describe("Pool screen", () => {
  it("shows the book, the lock and the groups against the cap", () => {
    const html = renderToStaticMarkup(<PoolView data={ok} account="me.testnet" />);
    expect(html).toContain("NEAR book");
    expect(html).toContain("Locked");
    expect(html).toContain("HASH_A");
    expect(html).toContain("75.0%"); // 15 of a 20 NEAR cap (2 x 10)
    expect(html).toContain("Your share of this book: <span class=\"mono\">25%</span>");
    expect(html).not.toContain("1000");
  });

  it("shows no share line without a wallet, and says deposits are not in the console", () => {
    const html = renderToStaticMarkup(<PoolView data={ok} account={null} />);
    expect(html).not.toContain("Your share");
    expect(html).toContain("aren&#x27;t in the console yet");
  });

  it("shows a read error, not a partial book", () => {
    const html = renderToStaticMarkup(<PoolView data={{ state: "error", message: "rpc down" }} account={null} />);
    expect(html).toContain("Couldn&#x27;t read the pool."); expect(html).toContain("rpc down");
    expect(html).not.toContain("NEAR book");
  });
});
