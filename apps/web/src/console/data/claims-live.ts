import type { Coverage } from "@aruna/sdk/coverage";
import { tokenOf } from "./coverage-live";

// Reports and claims as the registry and the pool hold them, for one vault. The pool decides whether a claim pays and how
// much; the screen only reads what it decided. The formula terms are shown beside the pool's number so a reader can check it
// by hand (R29), and a term that could not be read is shown as unread, never as zero.

export interface ReportRow {
  id: number;
  target: string;
  attestor: string;
  channel: string;
  state: string;
  changedAtBlock: number;
  observedAtBlock: number;
  reportedAtBlock: number;
  beforeHash: string;
  afterHash: string;
}

export interface StoredReport {
  id: number;
  state: string;
  reported_at_block: number;
  report: { target: string; attestor: string; channel: string; changed_at_block: number; observed_at_block: number; before_resolved_hash: string; after_resolved_hash: string };
}

export const reportRow = (r: StoredReport): ReportRow => ({
  id: r.id,
  target: r.report.target,
  attestor: r.report.attestor,
  channel: r.report.channel,
  state: r.state,
  changedAtBlock: r.report.changed_at_block,
  observedAtBlock: r.report.observed_at_block,
  reportedAtBlock: r.reported_at_block,
  beforeHash: r.report.before_resolved_hash,
  afterHash: r.report.after_resolved_hash,
});

export interface ClaimRow {
  coverageId: number;
  target: string;
  token: string;
  reportId: number;
  block: number;
  /** The pool's own words for what happened. */
  outcome: string;
  paid: string;
  ratioBps: number;
  limit: string;
  /** The block the pool counted exposure from for this claim: the purchase, or the change an earlier claim paid. */
  paidThroughBlock: number;
  /** Exposure recorded before the changed block, and before `paidThroughBlock`; null when not read. */
  exposureUntilChange: string | null;
  exposureUntilStart: string | null;
  /** The exposure that counts: until the change, less what was recorded before the start. Null when either term was not read. */
  exposureInWindow: string | null;
  /** The limit less what earlier claims on this coverage paid. */
  remainingBefore: string;
  /** min(exposure in the window x ratio, remaining limit), shown beside what the pool paid. Null when the exposure was not read. */
  byFormula: string | null;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** payout = min(exposure in the window x ratio, remaining limit). Integer arithmetic, rounded down like the pool. */
export function formulaPayout(exposureInWindow: bigint, ratioBps: number, remaining: bigint): bigint {
  return min((exposureInWindow * BigInt(ratioBps)) / 10_000n, remaining);
}

export interface ClaimStep {
  coverage: Coverage;
  index: number;
  reportId: number;
  /** `paid_through_block` as the pool had it when this claim ran: the purchase block, then the change of each paid claim before it. */
  paidThroughBlock: number;
  /** The changed block of the report, or null when the report was not read. */
  changedAtBlock: number | null;
  remainingBefore: bigint;
}

/** Walks each coverage's claims in order, carrying `paid_through_block` and the limit used, as the pool did. */
export function claimSteps(list: readonly Coverage[], reports: ReadonlyMap<number, ReportRow>): ClaimStep[] {
  const out: ClaimStep[] = [];
  for (const c of list) {
    let through = c.start_block;
    let paidBefore = 0n;
    c.claims.forEach((k, index) => {
      const rep = reports.get(k.report_id);
      const remaining = BigInt(c.limit) - paidBefore;
      out.push({ coverage: c, index, reportId: k.report_id, paidThroughBlock: through, changedAtBlock: rep ? rep.changedAtBlock : null, remainingBefore: remaining < 0n ? 0n : remaining });
      if (k.outcome === "paid") {
        paidBefore += BigInt(k.paid);
        if (rep) through = rep.changedAtBlock;
      }
    });
  }
  return out;
}

export const exposureKey = (coverageId: number, index: number) => `${coverageId}:${index}`;

export interface ExposureRead {
  untilChange: string;
  untilStart: string;
}

/** Every claim attempt on the vault's coverages, oldest first within a coverage. */
export function claimRows(list: readonly Coverage[], reports: ReadonlyMap<number, ReportRow>, exposure: ReadonlyMap<string, ExposureRead>): ClaimRow[] {
  return claimSteps(list, reports).map((s) => {
    const k = s.coverage.claims[s.index];
    const e = exposure.get(exposureKey(s.coverage.id, s.index)) ?? null;
    const inWindow = e ? (BigInt(e.untilChange) > BigInt(e.untilStart) ? BigInt(e.untilChange) - BigInt(e.untilStart) : 0n) : null;
    return {
      coverageId: s.coverage.id,
      target: s.coverage.target,
      token: tokenOf(s.coverage.token),
      reportId: s.reportId,
      block: k.block,
      outcome: k.outcome,
      paid: k.paid,
      ratioBps: s.coverage.payout_ratio_bps,
      limit: s.coverage.limit,
      paidThroughBlock: s.paidThroughBlock,
      exposureUntilChange: e?.untilChange ?? null,
      exposureUntilStart: e?.untilStart ?? null,
      exposureInWindow: inWindow === null ? null : inWindow.toString(),
      remainingBefore: s.remainingBefore.toString(),
      byFormula: inWindow === null ? null : formulaPayout(inWindow, s.coverage.payout_ratio_bps, s.remainingBefore).toString(),
    };
  });
}

export interface Startable {
  coverageId: number;
  target: string;
  reportId: number;
}

/**
 * Coverage and report pairs a claim can be started for: the report is verified, is about the covered target, and no claim on
 * that report has paid or is running. The pool still checks the rest (waiting period, challenge window, exposure) and answers
 * with a reason, which the screen shows as an outcome.
 */
export function startable(list: readonly Coverage[], latest: ReadonlyMap<string, ReportRow>): Startable[] {
  const out: Startable[] = [];
  for (const c of list) {
    const r = latest.get(c.target);
    if (!r || r.state !== "verified" || c.released || c.claim_in_flight) continue;
    if (c.claims.some((k) => k.report_id === r.id && k.outcome === "paid")) continue;
    out.push({ coverageId: c.id, target: c.target, reportId: r.id });
  }
  return out;
}
