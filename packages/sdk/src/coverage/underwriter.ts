// The underwriter's actions: add capital to a pool book and take it out. Like coverage purchase these
// are OWNER-side actions and never reachable by an agent key, here or in MCP: an agent key's
// function-call permission lists no pool method (CLAUDE.md, docs/SDK.md).
//
// A refusal resolves as { ok: false, reason }; an authorization failure that is not a pool refusal
// throws. The pool refuses a withdrawal with a panic (a refusal that panics cannot record anything),
// so the panics that name a pool reason are turned into refusals here. An outcome no pool event shows
// is never reported as success: it throws, so the caller looks at the chain instead of assuming.
import { ArunaAuthError, ArunaRpcError, type VaultTransport } from "../vault/transport.js";
import { poolEvents } from "./events.js";
import { tokenId, type TokenName } from "./pool.js";

/** The gas the client attaches, in Tgas. A console shows the same figures before it signs, so it reads them from here. */
export const UNDERWRITER_GAS_TGAS = { deposit: 30n, depositFt: 100n, withdraw: 50n } as const;

/** The reasons the pool contract panics with (docs/CONTRACTS.md), without the ARUNA_ prefix. A test keeps them in the contract. Kept apart from the vault's REASONS, which a test pins to the vault. */
export const POOL_PANIC_REASONS = ["CAPITAL_LOCKED", "NOT_ENOUGH_SHARES", "ZERO_DEPOSIT", "DEPOSIT_TOO_SMALL"] as const;
/** Refusals the client decides itself, before sending or from what came back. */
export const UNDERWRITER_CLIENT_REASONS = ["DEPOSIT_REFUNDED", "PAYOUT_NOT_REGISTERED"] as const;
export type UnderwriterReason = (typeof POOL_PANIC_REASONS)[number] | (typeof UNDERWRITER_CLIENT_REASONS)[number];

export type DepositResult = { ok: true; amount: string; shares: string; tx: string } | { ok: false; reason: UnderwriterReason; tx: string | null };
export type WithdrawResult = { ok: true; amount: string; tx: string } | { ok: false; reason: UnderwriterReason; tx: string | null };

/** The pool reason a panic message names, if it names one. */
function panicReason(e: unknown): (typeof POOL_PANIC_REASONS)[number] | null {
  if (!(e instanceof ArunaAuthError)) return null;
  for (const m of e.detail.matchAll(/ARUNA_([A-Z_]+)/g)) {
    const code = POOL_PANIC_REASONS.find((r) => r === m[1]);
    if (code) return code;
  }
  return null;
}

export class Underwriter {
  /** The transport's `signerId` is the underwriter. `token` is "near" or a NEP-141 contract's account id. */
  constructor(private readonly o: { pool: string; transport: VaultTransport }) {}

  /** Adds `amount` (the token's smallest unit) to the token's book and returns the shares the pool minted. */
  async deposit(o: { token: TokenName; amount: string }): Promise<DepositResult> {
    const { pool, transport } = this.o;
    let r;
    try {
      r =
        o.token === "near"
          ? await transport.call(pool, "deposit", {}, { depositYocto: BigInt(o.amount), tgas: UNDERWRITER_GAS_TGAS.deposit })
          : await transport.call(o.token, "ft_transfer_call", { receiver_id: pool, amount: o.amount, msg: JSON.stringify({ action: "deposit" }) }, { depositYocto: 1n, tgas: UNDERWRITER_GAS_TGAS.depositFt });
    } catch (e) {
      const reason = panicReason(e);
      if (reason) return { ok: false, reason, tx: null };
      throw e;
    }
    const credited = poolEvents(pool, r).find((e) => e.event === "capital_deposited" && e.data.underwriter === transport.signerId && JSON.stringify(e.data.token) === JSON.stringify(tokenId(o.token)));
    if (credited) return { ok: true, amount: String(credited.data.amount), shares: String(credited.data.shares), tx: r.tx };
    // The token contract refunds a deposit the pool panicked on: the transaction succeeds and returns the unused amount, which is all of it.
    if (o.token !== "near" && r.value === "0") return { ok: false, reason: "DEPOSIT_REFUNDED", tx: r.tx };
    throw new ArunaRpcError(`deposit outcome unknown: ${r.tx} shows no capital_deposited for ${transport.signerId}; check the pool's shares and your token balance before retrying`);
  }

  /** Burns `shares` for their part of the book's capital. A USDC payout goes out as a detached transfer, so a holder not registered on the token is refused before anything is sent. */
  async withdraw(o: { token: TokenName; shares: string }): Promise<WithdrawResult> {
    const { pool, transport } = this.o;
    if (o.token !== "near") {
      const registered = await transport.view<unknown>(o.token, "storage_balance_of", { account_id: transport.signerId });
      if (registered === null || registered === undefined) return { ok: false, reason: "PAYOUT_NOT_REGISTERED", tx: null };
    }
    let r;
    try {
      r = await transport.call(pool, "withdraw", { token: tokenId(o.token), shares: o.shares }, { depositYocto: 1n, tgas: UNDERWRITER_GAS_TGAS.withdraw });
    } catch (e) {
      const reason = panicReason(e);
      if (reason) return { ok: false, reason, tx: null };
      throw e;
    }
    const paid = poolEvents(pool, r).find((e) => e.event === "capital_withdrawn" && e.data.underwriter === transport.signerId && JSON.stringify(e.data.token) === JSON.stringify(tokenId(o.token)));
    if (paid) return { ok: true, amount: String(paid.data.amount), tx: r.tx };
    throw new ArunaRpcError(`withdrawal outcome unknown: ${r.tx} shows no capital_withdrawn for ${transport.signerId}; check the pool's shares before retrying`);
  }
}
