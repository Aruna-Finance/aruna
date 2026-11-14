import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Book, Coverage } from "@aruna/sdk/coverage";
import { describe, expect, it } from "vitest";
import {
  BOOK_TOKENS,
  CONCENTRATION_BPS,
  K_X100,
  bookFigures,
  bpsText,
  checkDeposit,
  checkWithdraw,
  depositBlock,
  groupRows,
  mintedShares,
  payoutFor,
  stageCounts,
  withdrawBlock,
  type WalletToken,
} from "./pool-live";
import { USDC } from "./price";

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

describe("stageCounts", () => {
  const list = [cov({ id: 0 }), cov({ id: 1, paid_out: "5" }), cov({ id: 2, claim_in_flight: true }), cov({ id: 3, released: true }), cov({ id: 4, token: { ft: "u.testnet" } })];
  it("counts by stage for one token", () => {
    expect(stageCounts(list, "near", 2)).toEqual({ active: 1, ended: 0, claimInFlight: 1, paid: 1, released: 1 });
    expect(stageCounts(list, "near", 3).ended).toBe(1);
  });
  it("writes basis points as a percentage", () => {
    expect(bpsText(3200)).toBe("32.0%");
  });
});

describe("the books the screen lists", () => {
  it("are NEAR and the test USDC, in that order, whatever token a coverage uses", () => {
    expect(BOOK_TOKENS).toEqual(["near", USDC]);
    expect(USDC).toBe("usdc.arunafi.testnet");
  });
});

// The pool's own share maths (contracts/pool/src/lib.rs deposit_for and withdraw), shown to the user as estimates.
describe("share maths", () => {
  it("mints 1:1 into an empty book", () => {
    expect(mintedShares(500n, 0n, 0n)).toBe(500n);
  });
  it("prices a deposit at the book's capital per share, rounded down", () => {
    expect(mintedShares(1n, 10n, 1000n)).toBe(100n);
    expect(mintedShares(1n, 3n, 10n)).toBe(3n);
  });
  it("does not divide by zero when the book has no capital left but still has shares", () => {
    expect(mintedShares(5n, 0n, 500n)).toBe(5n);
    expect(payoutFor(10n, 0n, 0n)).toBe(0n);
  });
  it("pays a holder shares x capital / total shares, rounded down", () => {
    expect(payoutFor(250n, 10_000n, 1000n)).toBe(2500n);
    expect(payoutFor(1n, 10n, 3n)).toBe(3n);
  });
});

const fmt = (v: bigint) => `${v}`;
const near = (o: Partial<Book> = {}) => bookFigures("near", book({ capital: "10000", total_shares: "1000", locked_until: 500, ...o }), 100);
const walletOk = (balance: bigint, registered = true): WalletToken => ({ state: "ok", balance, registered });

describe("deposit checks", () => {
  it("estimates the shares bought and the share of the book they make", () => {
    const f = near({ capital: "10", total_shares: "1000" });
    expect(checkDeposit("1", 0, f, 5n, fmt)).toEqual({ ok: true, amount: 1n, shares: 100n, shareBps: 909 });
  });
  it("reads a typed amount in the token's units", () => {
    const f = near({ capital: "0", total_shares: "0" });
    expect(checkDeposit("12.5", 6, f, 20_000_000n, fmt)).toMatchObject({ ok: true, amount: 12_500_000n, shares: 12_500_000n });
  });
  it("refuses an empty, malformed, negative or zero amount", () => {
    const f = near();
    for (const t of ["", "1.2.3", "-1", "0", "abc"]) expect(checkDeposit(t, 6, f, 10n ** 9n, fmt)).toMatchObject({ ok: false });
  });
  it("refuses more than the wallet holds", () => {
    expect(checkDeposit("2", 0, near(), 1n, fmt)).toMatchObject({ ok: false, reason: expect.stringContaining("more than") });
  });
  it("refuses an amount too small to buy one share", () => {
    expect(checkDeposit("1", 0, near({ capital: "5000", total_shares: "10" }), 9n, fmt)).toMatchObject({ ok: false, reason: expect.stringContaining("Too small") });
  });
});

describe("deposit and withdraw blocks", () => {
  it("covers AE7: a book with no capital but outstanding shares takes no deposit", () => {
    const f = near({ capital: "0", total_shares: "500" });
    expect(depositBlock(f, "near", "NEAR", walletOk(10n))).toMatch(/earlier holders/);
    expect(depositBlock(near(), "near", "NEAR", walletOk(10n))).toBeNull();
  });
  it("covers AE2: a wallet with none of the token is told the test token is not publicly mintable", () => {
    expect(depositBlock(near(), USDC, "tUSDC", walletOk(0n))).toMatch(/isn't publicly mintable/);
    expect(depositBlock(near(), USDC, "tUSDC", walletOk(5n))).toBeNull();
  });
  it("waits for, and says when it could not read, what the guards need", () => {
    expect(depositBlock(near(), "near", "NEAR", { state: "loading" })).toMatch(/Checking/);
    expect(depositBlock(near(), "near", "NEAR", undefined)).toMatch(/Checking/);
    expect(depositBlock(near(), USDC, "tUSDC", { state: "error", message: "rpc" })).toMatch(/Could not read/);
  });
  it("covers AE3: a locked book shows the blocks left; an unlocked one is open", () => {
    expect(withdrawBlock(near({ locked_until: 500 }), 10n, "near", "NEAR", walletOk(0n))).toMatch(/400 more blocks/);
    expect(withdrawBlock(bookFigures("near", book({ locked_until: 50 }), 100), 10n, "near", "NEAR", walletOk(0n))).toBeNull();
  });
  it("covers AE8: a USDC holder not registered on the token cannot withdraw, and the check waits for its read", () => {
    const open = bookFigures(USDC, book({ locked_until: 50 }), 100);
    expect(withdrawBlock(open, 10n, USDC, "tUSDC", walletOk(0n, false))).toMatch(/isn't registered/);
    expect(withdrawBlock(open, 10n, USDC, "tUSDC", walletOk(0n, true))).toBeNull();
    expect(withdrawBlock(open, 10n, USDC, "tUSDC", undefined)).toMatch(/Checking/);
    expect(withdrawBlock(open, 10n, USDC, "tUSDC", { state: "error", message: "x" })).toMatch(/Could not/);
  });
  it("a holder with no shares has nothing to withdraw", () => {
    expect(withdrawBlock(near({ locked_until: 50 }), 0n, "near", "NEAR", walletOk(0n))).toMatch(/no position/);
  });
});

describe("withdraw checks", () => {
  const f = near({ capital: "10000", total_shares: "1000", locked_until: 50 });
  it("converts a token amount to shares rounded down, so the payout never exceeds what was asked", () => {
    const r = checkWithdraw({ text: "25" }, 0, f, 500n, fmt);
    expect(r).toEqual({ ok: true, shares: 2n, receives: 20n });
    if (r.ok) expect(r.receives).toBeLessThanOrEqual(25n);
  });
  it("everything sends the exact share count the holder owns", () => {
    expect(checkWithdraw({ all: true }, 0, f, 333n, fmt)).toEqual({ ok: true, shares: 333n, receives: 3330n });
  });
  it("refuses an amount worth less than one share, and one above the holder's position", () => {
    expect(checkWithdraw({ text: "5" }, 0, f, 500n, fmt)).toMatchObject({ ok: false, reason: expect.stringContaining("Too small") });
    expect(checkWithdraw({ text: "9000" }, 0, f, 500n, fmt)).toMatchObject({ ok: false, reason: expect.stringContaining("more than your position") });
  });
  it("refuses malformed input and a holder with no shares", () => {
    expect(checkWithdraw({ text: "1,5" }, 0, f, 500n, fmt)).toMatchObject({ ok: false });
    expect(checkWithdraw({ all: true }, 0, f, 0n, fmt)).toMatchObject({ ok: false });
  });
});
