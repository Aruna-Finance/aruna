// The owner's coverage actions: buy and claim. Coverage purchase is an OWNER action and is never
// reachable by an agent key, here or in MCP (CLAUDE.md, docs/SDK.md). Two things hold that: the
// pool refuses a buyer who is not the vault's registered owner, and an agent key's function-call
// permission lists no pool method. This class therefore adds no check of its own.
//
// A refusal resolves as { ok: false, reason }; an authorization failure (a panic, a refused key)
// throws. An outcome the logs do not show is never reported as success: it throws, so the caller
// looks at the chain instead of assuming.
import { ArunaRpcError, type VaultTransport } from "../vault/transport.js";
import { poolEvents } from "./events.js";
import type { Coverage, TokenName } from "./pool.js";

/** Mirrors aruna_common::params::MIN_CLAIM_GAS_TGAS; a test keeps the two equal. */
export const MIN_CLAIM_GAS_TGAS = 150n;
const TGAS_BUY = 200n;
const TGAS_BUY_FT = 300n;
const TGAS_CLAIM = 200n;

export interface BuyRequest {
  vault: string;
  agentPublicKey: string;
  target: string;
  /** Sum insured, in the token's smallest unit. */
  limit: string;
  payoutRatioBps: number;
  windowBlocks: number;
}

export type BuyResult = { ok: true; coverageId: number; premium: string; coverage: Coverage; tx: string } | { ok: false; reason: string; tx: string };
export type ClaimResult = { ok: true; paid: string; tx: string } | { ok: false; reason: string; tx: string };

export class OwnerCoverage {
  /** `token` is a NEP-141 contract's account id for an FT; its `signerId` must be the vault's owner. */
  constructor(private readonly o: { pool: string; transport: VaultTransport }) {}

  /**
   * Buys coverage. `maxPremium` is what the owner is willing to pay, in the token's smallest unit: it is
   * attached (NEAR) or transferred (FT), the contract charges its own quote, and the excess comes back.
   * Quote first with `quoteCoverage`; the price can still move before the purchase lands.
   */
  async buy(o: { request: BuyRequest; token: TokenName; maxPremium: string }): Promise<BuyResult> {
    const req = { vault: o.request.vault, agent: o.request.agentPublicKey, target: o.request.target, limit: o.request.limit, payout_ratio_bps: o.request.payoutRatioBps, window_blocks: o.request.windowBlocks };
    const r =
      o.token === "near"
        ? await this.o.transport.call(this.o.pool, "buy_coverage", { request: req }, { depositYocto: BigInt(o.maxPremium), tgas: TGAS_BUY })
        : await this.o.transport.call(o.token, "ft_transfer_call", { receiver_id: this.o.pool, amount: o.maxPremium, msg: JSON.stringify({ action: "buy", ...req }) }, { depositYocto: 1n, tgas: TGAS_BUY_FT });
    const events = poolEvents(this.o.pool, r);
    const bought = events.find((e) => e.event === "coverage_purchased");
    if (bought) {
      const coverage = bought.data.coverage as Coverage;
      return { ok: true, coverageId: coverage.id, premium: coverage.premium_paid, coverage, tx: r.tx };
    }
    const refused = events.find((e) => e.event === "coverage_refused");
    if (refused) return { ok: false, reason: String(refused.data.reason), tx: r.tx };
    throw new ArunaRpcError(`purchase outcome unknown: ${r.tx} shows neither coverage_purchased nor coverage_refused; check the pool's coverages before retrying`);
  }

  /**
   * Starts a claim against a verified drift report. Anyone may start one; the payout always goes to the
   * coverage's owner. A rejection resolves as { ok: false, reason }; a claim already paid or in flight,
   * or too little gas, throws.
   */
  async claim(o: { coverageId: number; reportId: number; tgas?: bigint }): Promise<ClaimResult> {
    const tgas = o.tgas ?? TGAS_CLAIM;
    if (tgas < MIN_CLAIM_GAS_TGAS) throw new RangeError(`a claim needs at least ${MIN_CLAIM_GAS_TGAS} Tgas for its callbacks; got ${tgas}`);
    const r = await this.o.transport.call(this.o.pool, "claim", { coverage_id: o.coverageId, report_id: o.reportId }, { depositYocto: 0n, tgas });
    const events = poolEvents(this.o.pool, r);
    const paid = events.find((e) => e.event === "claim_paid");
    if (paid) return { ok: true, paid: typeof r.value === "string" ? r.value : String(r.value ?? "0"), tx: r.tx };
    const rejected = events.find((e) => e.event === "claim_rejected");
    if (rejected) return { ok: false, reason: String(rejected.data.reason), tx: r.tx };
    throw new ArunaRpcError(`claim outcome unknown: ${r.tx} shows neither claim_paid nor claim_rejected; read the coverage before retrying`);
  }
}
