import type { Book, Coverage } from "@aruna/sdk/coverage";
import { describe, expect, it } from "vitest";
import { USDC } from "./data/price";
import { loadPoolLive, loadWalletTokens } from "./usePoolLive";

const ME = "me.testnet";
const book = (capital: string): Book => ({ capital, total_shares: capital, total_limits: "0", locked_until: 10 });
const cov = (token: Coverage["token"]) => ({ token }) as Coverage;

function fakePool(coverages: Coverage[]) {
  const booksRead: string[] = [];
  const sharesRead: string[] = [];
  return {
    booksRead,
    sharesRead,
    pool: {
      coverageCount: async () => coverages.length,
      coverage: async (id: number) => coverages[id] ?? null,
      book: async (t: string) => {
        booksRead.push(t);
        return book(t === "near" ? "100" : "200");
      },
      shares: async (_who: string, t: string) => {
        sharesRead.push(t);
        return "7";
      },
    },
    reads: { headBlock: async () => 42 },
  };
}

describe("loadPoolLive", () => {
  it("reads exactly the NEAR and USDC books, even when a coverage uses another token", async () => {
    const f = fakePool([cov("near"), cov({ ft: "evil-token.testnet" })]);
    const r = await loadPoolLive({ ...f, account: ME });
    expect([...r.books.keys()]).toEqual(["near", USDC]);
    expect(f.booksRead.sort()).toEqual(["near", USDC].sort());
    expect(r.head).toBe(42);
    expect(r.coverages).toHaveLength(2);
    expect(r.shares.get(USDC)).toBe("7");
  });

  it("reads no shares without an account", async () => {
    const f = fakePool([]);
    const r = await loadPoolLive({ ...f, account: null });
    expect(f.sharesRead).toEqual([]);
    expect(r.shares.size).toBe(0);
  });

  it("is an error for the whole screen when a book cannot be read, never a partial book", async () => {
    const f = fakePool([]);
    f.pool.book = async () => {
      throw new Error("rpc down");
    };
    await expect(loadPoolLive({ ...f, account: ME })).rejects.toThrow("rpc down");
  });
});

describe("loadWalletTokens", () => {
  const reads = (o: { usdcBalance?: string; registered?: unknown; fail?: string } = {}) => ({
    balance: async () => 5n * 10n ** 24n,
    view: async <T,>(contract: string, method: string): Promise<T> => {
      if (o.fail === method) throw new Error(`${contract}.${method} failed`);
      if (method === "ft_balance_of") return (o.usdcBalance ?? "2500000") as T;
      if (method === "storage_balance_of") return (o.registered === undefined ? { total: "1", available: "0" } : o.registered) as T;
      throw new Error(`unexpected ${method}`);
    },
  });

  it("reads the NEAR balance and, for a token, its balance and whether the account is registered on it", async () => {
    const m = await loadWalletTokens({ reads: reads(), account: ME, tokens: ["near", USDC] });
    expect(m.get("near")).toEqual({ state: "ok", balance: 5n * 10n ** 24n, registered: true });
    expect(m.get(USDC)).toEqual({ state: "ok", balance: 2_500_000n, registered: true });
  });

  it("an account the token has no storage for is not registered", async () => {
    const m = await loadWalletTokens({ reads: reads({ registered: null, usdcBalance: "0" }), account: ME, tokens: [USDC] });
    expect(m.get(USDC)).toEqual({ state: "ok", balance: 0n, registered: false });
  });

  it("a read that fails leaves that token in an error state and the others as they were", async () => {
    const m = await loadWalletTokens({ reads: reads({ fail: "storage_balance_of" }), account: ME, tokens: ["near", USDC] });
    expect(m.get("near")).toMatchObject({ state: "ok" });
    expect(m.get(USDC)).toMatchObject({ state: "error", message: expect.stringContaining("storage_balance_of") });
  });
});
