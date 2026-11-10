import { COVERAGE_ASSUME, NOW, type CoveragePolicy } from "./coverage";
import { coverageStore } from "./coverage-mock";
import { CLAIMS_ASSUME, payoutOf, type Claim, type ClaimsState, type ClaimsStore, type Condition, type Report } from "./claims";
import { vaultStore } from "./vault-mock";

// SIMULATED. The seed has no reports and no claims, as in the prototype. A report is created by the
// "simulate a drift report" action, which stands in for the attestor console (F6).

const ATTESTORS = ["attestor-1.testnet", "attestor-2.testnet"];
const BASE_BLOCK = 187_400_000;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A stable fake base58-looking hash, so the same target always shows the same mock value. */
/** The mock resolved code hash of a target, before or after its change. */
export const resolvedHash = (target: string, when: "before" | "after") => hash(`${target}:${when}`);

const hash = (seed: string) => {
  let h = 2166136261;
  let out = "";
  for (let i = 0; i < 44; i++) {
    h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 16777619) >>> 0;
    out += ALPHABET[h % ALPHABET.length];
  }
  return out;
};

export const attestorForTarget = (target: string) =>
  target === "router.testnet" || target === "router-2.testnet" ? "attestor-2.testnet" : "attestor-1.testnet";

/** The five conditions of a payable claim, evaluated against the report and the clock. */
export function conditionsFor(c: Claim, r: Report, policy: CoveragePolicy | undefined, now: number): Condition[] {
  const closed = now >= r.endsAt && r.status !== "disputed";
  return [
    {
      id: "active",
      label: "Coverage was active at the changed block",
      ok: !!policy && policy.startsAt <= r.changedAtSec && policy.expiresAt > r.changedAtSec,
    },
    { id: "waiting", label: "The waiting period had passed by then", ok: !!policy && policy.waitingEndsAt <= r.changedAtSec },
    { id: "exposure", label: "Exposure was recorded before the changed block", ok: c.exposure > 0 },
    { id: "limit", label: "The payout stays inside the remaining limit", ok: payoutOf(c) <= c.limit },
    { id: "challenge", label: "The challenge window closed with no upheld conflict", ok: closed && r.status !== "rejected" },
  ];
}

export interface ReportOpts {
  attestor?: string;
  channel?: string;
  /** Blocks between the change and the report. Sets changedAtBlock. */
  agoBlocks?: number;
  /** The resolved code hash after the change. An equal hash is rejected. */
  afterHash?: string;
}

export function createClaimsStore(): ClaimsStore & {
  reportDrift(target: string, opts?: ReportOpts): Report;
  advance(sec: number): void;
  conflict(id: string, attestor: string, resolvedHash: string): void;
  rule(id: string, uphold: boolean): void;
  policyOf(claim: Claim): CoveragePolicy | undefined;
} {
  let now = NOW;
  let reports: Report[] = [];
  let claims: Claim[] = [];
  const listeners = new Set<() => void>();
  const snap = (): ClaimsState => ({ now, arbiter: "arbiter.aruna.testnet", attestors: ATTESTORS, subscribedVaults: 14, reports, claims });
  let snapshot = snap();
  const emit = () => {
    snapshot = snap();
    listeners.forEach((l) => l());
  };
  const policyOf = (c: Claim) => coverageStore.book().find((p) => p.id === c.policy);

  const exposureOf = (p: CoveragePolicy) => {
    const own = vaultStore.get().agents.find((a) => a.id === p.agent);
    return own ? (own.exposure[p.target] ?? 0) : Math.round(p.limit * 0.4);
  };

  const settle = (id: string) => {
    const r = reports.find((x) => x.id === id)!;
    const uphold = r.ruling ? r.ruling.uphold : true;
    if (!uphold) {
      reports = reports.map((x) => (x.id === id ? { ...x, status: "rejected" } : x));
      claims = claims.map((c) =>
        c.report === id
          ? { ...c, status: "rejected", payout: 0, rejectReason: "The arbiter rejected the report. The attestor's bond was slashed and the target unfrozen." }
          : c,
      );
      return;
    }
    const paidReport: Report = { ...r, status: "paid" };
    reports = reports.map((x) => (x.id === id ? paidReport : x));
    claims = claims.map((c) => {
      if (c.report !== id) return c;
      const failed = conditionsFor(c, paidReport, policyOf(c), now).find((x) => !x.ok);
      return failed
        ? { ...c, status: "rejected", payout: 0, rejectReason: `Condition not met: ${failed.label}.` }
        : { ...c, status: "paid", payout: payoutOf(c) };
    });
  };

  return {
    get: () => snapshot,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    policyOf,
    reportDrift(target, opts = {}) {
      const afterHash = (opts.afterHash ?? resolvedHash(target, "after")).trim();
      if (afterHash === resolvedHash(target, "before")) throw new Error("ARUNA_HASHES_EQUAL: the resolved hash did not change, so there is nothing to report.");
      if ((opts.agoBlocks ?? 0) > CLAIMS_ASSUME.maxLookbackBlocks) throw new Error(`ARUNA_LOOKBACK_EXCEEDED: changedAtBlock must be within ${CLAIMS_ASSUME.maxLookbackBlocks} blocks.`);
      if (reports.some((r) => r.target === target && r.status === "challenge_window")) {
        throw new Error(`ARUNA_REPORT_OPEN: ${target} already has a report in its challenge window.`);
      }
      const n = reports.length + 1;
      const id = `r-${n}`;
      const r: Report = {
        id,
        target,
        attestor: opts.attestor ?? attestorForTarget(target),
        channel: opts.channel ?? "resolved_code",
        reportedAt: now,
        endsAt: now + COVERAGE_ASSUME.challengeWindowSec,
        observedAtBlock: BASE_BLOCK + n * 900,
        changedAtBlock: BASE_BLOCK + n * 900 - (opts.agoBlocks ?? 240),
        changedAtSec: now - (opts.agoBlocks ?? 240) * 1,
        beforeResolvedHash: hash(`${target}:before`),
        afterResolvedHash: afterHash,
        nonce: `drift-${target}-${n}`,
        bond: CLAIMS_ASSUME.attestorBond,
        status: "challenge_window",
      };
      reports = [...reports, r];
      claims = [
        ...claims,
        ...coverageStore
          .book()
          .filter((p) => p.target === target)
          .map(
            (p): Claim => ({
              id: `cl-${n}-${p.id}`,
              report: id,
              policy: p.id,
              agent: p.agent,
              target,
              exposure: exposureOf(p),
              limit: p.limit,
              payoutBps: p.payoutBps,
              status: "challenge_window",
              payout: 0,
            }),
          ),
      ];
      emit();
      return r;
    },
    advance(sec) {
      now += sec;
      reports.filter((r) => r.status === "challenge_window" && now >= r.endsAt).forEach((r) => settle(r.id));
      emit();
    },
    conflict(id, attestor, resolvedHash) {
      const r = reports.find((x) => x.id === id);
      if (!r) throw new Error("ARUNA_REPORT_NOT_FOUND");
      if (r.status !== "challenge_window") throw new Error("ARUNA_CHALLENGE_CLOSED: the challenge window is closed.");
      if (attestor === r.attestor) throw new Error("ARUNA_SAME_ATTESTOR: a conflicting report must come from a second attestor.");
      if (!resolvedHash.trim()) throw new Error("ARUNA_HASH_REQUIRED: enter the code hash read from view_code.");
      reports = reports.map((x) => (x.id === id ? { ...x, status: "disputed", conflict: { attestor, resolvedHash: resolvedHash.trim() } } : x));
      claims = claims.map((c) => (c.report === id ? { ...c, status: "disputed" } : c));
      emit();
    },
    rule(id, uphold) {
      const r = reports.find((x) => x.id === id);
      if (!r || r.status !== "disputed") throw new Error("ARUNA_NOT_DISPUTED: only a disputed report can be ruled on.");
      reports = reports.map((x) => (x.id === id ? { ...x, ruling: { uphold } } : x));
      settle(id);
      emit();
    },
  };
}

export const claimsStore = createClaimsStore();
