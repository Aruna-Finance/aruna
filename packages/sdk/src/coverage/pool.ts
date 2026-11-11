// Reads of the pool: books, coverages, shares. Keyless. There is no pool view that lists an owner's
// coverages, so `coverages` scans by id; that is fine on testnet and is the indexer's job later.
import type { PoolBook, PoolCoverage, PoolMethods, PoolTokenId } from "../generated/pool.js";
import type { ReadTransport } from "./transport.js";

export type Book = PoolBook;
export type Coverage = PoolCoverage;
/** "near", or a NEP-141 token contract's account id (the SDK-wide spelling, see vault-view.ts). */
export type TokenName = string;

type Method = keyof PoolMethods & string;
const SCAN_BATCH = 10;

export const tokenId = (t: TokenName): PoolTokenId => (t === "near" ? "near" : { ft: t });

export class Pool {
  constructor(private readonly o: { pool: string; transport: ReadTransport }) {}

  private view<M extends Method>(method: M, args: PoolMethods[M]["args"]): Promise<PoolMethods[M]["result"]> {
    return this.o.transport.view(this.o.pool, method, args as Record<string, unknown>);
  }

  get poolId(): string {
    return this.o.pool;
  }

  book(token: TokenName): Promise<Book> {
    return this.view("get_book", { token: tokenId(token) });
  }

  coverage(id: number): Promise<Coverage | null> {
    return this.view("get_coverage", { id });
  }

  coverageCount(): Promise<number> {
    return this.view("coverage_count", {});
  }

  /** An underwriter's shares in one token's book, as a string. */
  shares(underwriter: string, token: TokenName): Promise<string> {
    return this.view("get_shares", { underwriter, token: tokenId(token) });
  }

  /** Every coverage of an owner, or of a vault, in id order. A failed read throws; the list is never partial. */
  async coverages(filter: { owner: string } | { vault: string }): Promise<Coverage[]> {
    const n = await this.coverageCount();
    const found: Coverage[] = [];
    for (let from = 0; from < n; from += SCAN_BATCH) {
      const ids = Array.from({ length: Math.min(SCAN_BATCH, n - from) }, (_, i) => from + i);
      const batch = await Promise.all(ids.map((id) => this.coverage(id)));
      for (const c of batch) if (c && ("owner" in filter ? c.owner === filter.owner : c.vault === filter.vault)) found.push(c);
    }
    return found;
  }
}
