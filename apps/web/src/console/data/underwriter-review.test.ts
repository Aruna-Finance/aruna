import type { Book } from "@aruna/sdk/coverage";
import { describe, expect, it } from "vitest";
import { bookFigures, checkDeposit } from "./pool-live";
import { depositReview, lockText, sharePriceText, sharesToWithdraw, withdrawReview } from "./underwriter-review";

const book = (o: Partial<Book> = {}): Book => ({ capital: "10000", total_shares: "1000", total_limits: "0", locked_until: 500, ...o });
const fig = (o: Partial<Book> = {}, head = 100) => bookFigures("near", book(o), head);
const fmt = (v: bigint) => `${v} NEAR`;

describe("lockText", () => {
  it("covers AE1: a locked book names the block it is locked until and says new coverage can move it", () => {
    const t = lockText(fig({ locked_until: 278_833_053 }, 277_633_010));
    expect(t).toContain("#278,833,053");
    expect(t).toContain("1,200,043 more blocks");
    expect(t).toMatch(/new coverage on this book can push that later, for every underwriter/);
  });
  it("an open book still says new coverage locks every underwriter's capital", () => {
    const t = lockText(fig({ locked_until: 50 }));
    expect(t).toMatch(/open for withdrawal now/);
    expect(t).toMatch(/new coverage on this book locks all of its capital/);
  });
});

describe("sharePriceText", () => {
  it("is 1:1 for an empty book", () => {
    expect(sharePriceText(fig({ capital: "0", total_shares: "0" }))).toMatch(/^1\.0000 /);
  });
  it("is the book's capital per share to four places, a ratio and never a share count", () => {
    expect(sharePriceText(fig({ capital: "10520", total_shares: "10000" }))).toBe("1.0520");
    expect(sharePriceText(fig({ capital: "10", total_shares: "1000" }))).toBe("0.0100");
  });
});

describe("depositReview", () => {
  const f = fig({ capital: "200000", total_shares: "100000", locked_until: 500 });
  const check = checkDeposit("1234", 0, f, 10_000n, fmt);
  if (!check.ok) throw new Error("fixture");
  const r = depositReview({ label: "NEAR", amountText: "1234 NEAR", check, f, head: 100 });
  it("shows the amount, the estimated share of the book, the share price and the block the figures were read at", () => {
    const text = r.actions.join("\n");
    expect(text).toContain("Deposit 1234 NEAR into the NEAR book");
    expect(text).toContain("about 0.6% of the book");
    expect(text).toContain("share price of 2.0000");
    expect(text).toContain("block #100");
  });
  it("carries the lock disclosure as its note and never the raw share count", () => {
    expect(r.note).toContain("#500");
    expect(check.shares).toBe(617n);
    expect(r.actions.join("\n") + r.note).not.toContain("617");
    expect(new Set(r.actions).size).toBe(r.actions.length);
  });
});

describe("withdrawReview", () => {
  const f = fig({ locked_until: 50 });
  it("names the token amount the holder receives, as an estimate, and never the shares", () => {
    const r = withdrawReview({ label: "NEAR", receivesText: "12 NEAR", all: false, f, head: 100 });
    expect(r.actions.join("\n")).toContain("about 12 NEAR");
    expect(r.actions.join("\n")).toMatch(/estimate at block #100/);
    expect(r.actions.join("\n")).not.toMatch(/shares/);
  });
  it("says so when it is everything", () => {
    expect(withdrawReview({ label: "NEAR", receivesText: "12 NEAR", all: true, f, head: 100 }).actions[0]).toBe("Withdraw everything you hold in the NEAR book");
  });
});

describe("sharesToWithdraw", () => {
  it("everything sends the holder's shares as re-read just before signing, not the count shown on load", async () => {
    expect(await sharesToWithdraw({ all: true }, async () => 480n)).toBe("480");
  });
  it("a typed amount sends the shares worked out at review and reads nothing", async () => {
    const never = async (): Promise<bigint> => {
      throw new Error("must not read");
    };
    expect(await sharesToWithdraw({ shares: 7n }, never)).toBe("7");
  });
});
