import type { Book, Coverage } from "@aruna/sdk/coverage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { USDC } from "../data/price";
import type { WalletToken } from "../data/pool-live";
import type { TokenMeta } from "../data/token-amount";
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
  books: new Map([["near", book], [USDC, { capital: "0", total_shares: "0", total_limits: "0", locked_until: 0 }]]),
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

  it("shows no share line and no form without a wallet, and asks for one", () => {
    const html = renderToStaticMarkup(<PoolView data={ok} account={null} />);
    expect(html).not.toContain("Your share");
    expect(html).not.toContain("<form");
    expect(html).toContain("Connect a wallet to deposit or withdraw");
    expect(html).not.toContain("aren&#x27;t in the console yet");
  });

  it("shows a read error, not a partial book", () => {
    const html = renderToStaticMarkup(<PoolView data={{ state: "error", message: "rpc down" }} account={null} />);
    expect(html).toContain("Couldn&#x27;t read the pool."); expect(html).toContain("rpc down");
    expect(html).not.toContain("NEAR book");
  });
});

const meta: ReadonlyMap<string, TokenMeta> = new Map([[USDC, { symbol: "tUSDC", decimals: 6 }]]);
const wallet = (o: Record<string, WalletToken> = {}): ReadonlyMap<string, WalletToken> =>
  new Map<string, WalletToken>([["near", { state: "ok", balance: 5n * YOCTO, registered: true }], [USDC, { state: "ok", balance: 3_000_000n, registered: true }], ...Object.entries(o)]);
const view = (data: PoolLive, w: ReadonlyMap<string, WalletToken> | undefined = wallet()) => renderToStaticMarkup(<PoolView data={data} account="me.testnet" wallet={w} meta={meta} />);
const withBooks = (books: [string, Book][], shares: [string, string][] = [["near", "250"]]): PoolLive => ({ ...ok, books: new Map(books), shares: new Map(shares) });
const usdcBook = (o: Partial<Book> = {}): Book => ({ capital: "0", total_shares: "0", total_limits: "0", locked_until: 0, ...o });
const disabled = (html: string, label: string) => new RegExp(`<button[^>]*disabled=""[^>]*>${label}<`).test(html);
// The button's classes include Tailwind's `disabled:` variants, so only the attribute itself counts.
const enabled = (html: string, label: string) => new RegExp(`<button(?![^>]*disabled="")[^>]*>${label}<`).test(html);

describe("Pool screen: deposit", () => {
  it("offers a deposit form for each book to a connected wallet, with the wallet's balance", () => {
    const html = view(ok);
    expect(html).toContain("Deposit NEAR");
    expect(html).toContain("Deposit tUSDC");
    expect(html).toContain("Your wallet holds 5 NEAR");
    expect(html).toContain("Your wallet holds 3 tUSDC");
  });
  it("covers AE2: a wallet with none of the test token is told it is not publicly mintable, and cannot submit", () => {
    const html = view(ok, wallet({ [USDC]: { state: "ok", balance: 0n, registered: true } }));
    expect(html).toContain("isn&#x27;t publicly mintable");
    expect(disabled(html, "Review deposit")).toBe(true);
  });
  it("covers AE7: a book with no capital but shares outstanding takes no deposit, and says why", () => {
    const html = view(withBooks([["near", book], [USDC, usdcBook({ total_shares: "500" })]]));
    expect(html).toContain("Deposits are paused");
    expect(html).toContain("earlier holders");
  });
  it("waits, rather than allows, while the wallet's holdings have not been read", () => {
    const html = view(ok, new Map());
    expect(html).toContain("Checking your balance.");
    expect(enabled(html, "Review deposit")).toBe(false);
  });
  it("says so when the wallet's holdings could not be read", () => {
    expect(view(ok, wallet({ near: { state: "error", message: "rpc" } }))).toContain("Could not read your balance");
  });
});

describe("Pool screen: withdraw", () => {
  it("covers AE3: a holder of a locked book sees the withdraw form, the blocks remaining and no way to submit", () => {
    const html = view(ok);
    expect(html).toContain("Withdraw NEAR");
    expect(html).toContain("The book is locked for 400 more blocks.");
    expect(disabled(html, "Review withdrawal")).toBe(true);
    expect(disabled(html, "Withdraw everything")).toBe(true);
  });
  it("shows what the position is worth in tokens, never in shares", () => {
    const html = view(ok);
    expect(html).toContain("Your position is worth 2.5 NEAR");
    expect(html).not.toMatch(/>250</);
  });
  it("an unlocked book lets a holder withdraw everything", () => {
    const html = view(withBooks([["near", { ...book, locked_until: 400 }], [USDC, usdcBook()]]));
    expect(html).not.toContain("is locked for");
    expect(enabled(html, "Withdraw everything")).toBe(true);
  });
  it("a holder with no shares sees no withdraw form, only that there is no position", () => {
    const html = view(withBooks([["near", book], [USDC, usdcBook()]], []));
    expect(html).toContain("You have no position in this book.");
    expect(html).not.toContain("Review withdrawal");
    expect(html).not.toContain("Withdraw everything");
  });
  it("covers AE8: an unlocked USDC book cannot be withdrawn by a holder not registered on the token", () => {
    const data = withBooks([["near", book], [USDC, usdcBook({ capital: "1000", total_shares: "1000" })]], [["near", "250"], [USDC, "500"]]);
    const html = view(data, wallet({ [USDC]: { state: "ok", balance: 0n, registered: false } }));
    expect(html).toContain("isn&#x27;t registered on the tUSDC contract");
    expect(disabled(html, "Withdraw everything")).toBe(true);
  });
  it("waits for the registration read before offering a USDC withdrawal", () => {
    const data = withBooks([["near", book], [USDC, usdcBook({ capital: "1000", total_shares: "1000" })]], [["near", "250"], [USDC, "500"]]);
    expect(view(data, new Map())).toContain("Checking your registration on tUSDC.");
  });
});
