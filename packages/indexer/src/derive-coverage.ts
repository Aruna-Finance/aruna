// Coverage, claims and drift state, derived from the registry's and the pool's events (R7). Like the
// rest of derive.ts it is a pure function of the raw records applied in seq order, so a rebuild, or a
// re-derivation from the raw table, gives the same rows. Nothing here reads the chain.
//
// Each update below follows what the contract does with the same event: the pool adds a payout to a
// coverage's `paid_out` on `claim_paid`; the registry settles BOTH reports of a dispute on `report_ruled`
// and zeroes the loser's bond; a report's freeze is the registry's `set_frozen` when it accepts one.

import type { Queryable } from "./db.js";
import { tokenKey } from "./derive.js";
import type { RawRecord } from "./ingest/parse.js";

type Row = Record<string, unknown>;
const obj = (x: unknown): Record<string, unknown> | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const int = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) ? x : null);
const big = (x: unknown): bigint => (typeof x === "string" && /^\d+$/.test(x) ? BigInt(x) : 0n);
const json = (x: unknown): string => JSON.stringify(x ?? null);

export async function applyCoverageAndDrift(db: Queryable, seq: number, rec: RawRecord): Promise<void> {
  const d = rec.data;
  const chain = { $seq: seq, $block: rec.block, $ts: rec.timestamp_ms, $tx: rec.tx_hash, $receipt: rec.receipt_id };
  const registry = rec.contract;

  switch (rec.name) {
    // ---- pool ----
    case "coverage_purchased": {
      const c = obj(d.coverage);
      if (!c || int(c.id) === null) return;
      await db.run(`INSERT INTO coverages (seq, pool, id, owner, vault, agent, target, token, limit_amount, payout_ratio_bps, premium_paid, class, code_hash, upgrade_authority,
           start_block, waiting_period_ends, end_block, policy_version, daily_cap_priced, block, timestamp_ms, tx_hash, receipt_id)
         VALUES ($seq, $pool, $id, $owner, $vault, $agent, $target, $token, $limit, $ratio, $premium, $class, $code_hash, $authority,
           $start, $waiting, $end, $policy_version, $cap, $block, $ts, $tx, $receipt) ON CONFLICT DO NOTHING`, {
        ...chain,
        $pool: rec.contract,
        $id: int(c.id),
        $owner: str(c.owner),
        $vault: str(c.vault),
        $agent: str(c.agent),
        $target: str(c.target),
        $token: tokenKey("coverage_purchased", c.token),
        $limit: str(c.limit),
        $ratio: int(c.payout_ratio_bps),
        $premium: str(c.premium_paid),
        $class: str(c.class),
        $code_hash: str(c.code_hash),
        $authority: str(c.upgrade_authority),
        $start: int(c.start_block),
        $waiting: int(c.waiting_period_ends),
        $end: int(c.end_block),
        $policy_version: int(c.policy_version),
        $cap: str(c.daily_cap_priced),
      });
      return;
    }
    case "claim_paid":
    case "claim_rejected": {
      const coverage = int(d.coverage);
      if (coverage === null) return;
      const paid = rec.name === "claim_paid";
      const cov = (await db.query("SELECT vault, target, owner FROM coverages WHERE pool = ? AND id = ?", [rec.contract, coverage]))[0] as Row | undefined;
      await db.run(`INSERT INTO claims (seq, pool, coverage, report, outcome, reason, payout, exposure_in_window, exposure_before_change, exposure_through_last_paid_block,
           payout_ratio_bps, limit_amount, paid_before, to_account, token, vault, target, owner, block, timestamp_ms, tx_hash, receipt_id)
         VALUES ($seq, $pool, $coverage, $report, $outcome, $reason, $payout, $in_window, $before_change, $through, $ratio, $limit, $paid_before, $to, $token, $vault, $target, $owner, $block, $ts, $tx, $receipt)`, {
        ...chain,
        $pool: rec.contract,
        $coverage: coverage,
        $report: int(d.report),
        $outcome: paid ? "paid" : "rejected",
        $reason: paid ? null : str(d.reason),
        $payout: paid ? str(d.payout) : null,
        $in_window: paid ? str(d.exposure_in_window) : null,
        $before_change: paid ? str(d.exposure_before_change) : null,
        $through: paid ? str(d.exposure_through_last_paid_block) : null,
        $ratio: paid ? int(d.payout_ratio_bps) : null,
        $limit: paid ? str(d.limit) : null,
        $paid_before: paid ? str(d.paid_before) : null,
        $to: paid ? str(d.to) : null,
        $token: paid ? tokenKey("claim_paid", d.token) : null,
        $vault: str(cov?.vault),
        $target: str(cov?.target),
        $owner: str(cov?.owner),
      });
      if (paid) {
        const cur = (await db.query("SELECT paid_out FROM coverages WHERE pool = ? AND id = ?", [rec.contract, coverage]))[0] as Row | undefined;
        if (cur) await db.run("UPDATE coverages SET paid_out = ?, claims_paid = claims_paid + 1 WHERE pool = ? AND id = ?", [(big(cur.paid_out) + big(d.payout)).toString(), rec.contract, coverage]);
      } else await db.run("UPDATE coverages SET claims_rejected = claims_rejected + 1 WHERE pool = ? AND id = ?", [rec.contract, coverage]);
      return;
    }
    case "coverage_released": {
      const id = int(d.coverage);
      if (id !== null) await db.run("UPDATE coverages SET released = 1 WHERE pool = ? AND id = ?", [rec.contract, id]);
      return;
    }

    // ---- registry: drift ----
    case "drift_reported": {
      const r = obj(d.report);
      const id = int(d.id);
      if (!r || id === null) return;
      const state = str(d.state) ?? "pending";
      await db.run(`INSERT INTO reports (seq, registry, id, target, attestor, observed_at_block, changed_at_block, before_ref, after_ref, before_resolved_hash, after_resolved_hash,
           channel, nonce, expires_at, reported_at_block, state, block, timestamp_ms, tx_hash, receipt_id)
         VALUES ($seq, $registry, $id, $target, $attestor, $observed, $changed, $before_ref, $after_ref, $before_hash, $after_hash, $channel, $nonce, $expires, $reported, $state, $block, $ts, $tx, $receipt) ON CONFLICT DO NOTHING`, {
        ...chain,
        $registry: registry,
        $id: id,
        $target: str(r.target),
        $attestor: str(r.attestor),
        $observed: int(r.observed_at_block),
        $changed: int(r.changed_at_block),
        $before_ref: json(r.before_ref),
        $after_ref: json(r.after_ref),
        $before_hash: str(r.before_resolved_hash),
        $after_hash: str(r.after_resolved_hash),
        $channel: str(r.channel),
        $nonce: int(r.nonce),
        $expires: int(r.expires_at),
        $reported: int(d.reported_at_block),
        $state: state,
      });
      // The registry emits `report_disputed` BEFORE the `drift_reported` of the report that disputes, so when
      // that event was applied this row did not exist yet: link it back to the report it disputes now.
      if (state === "disputed") {
        const prev = (await db.query("SELECT id FROM reports WHERE registry = ? AND disputed_by = ? ORDER BY id LIMIT 1", [registry, id]))[0] as Row | undefined;
        if (prev) await db.run("UPDATE reports SET disputed_by = ? WHERE registry = ? AND id = ?", [Number(prev.id), registry, id]);
      }
      // The registry freezes the target the moment it accepts a report.
      await freeze(db, chain, registry, str(r.target), "frozen", id, null, null, true);
      await db.run("UPDATE attestors SET reports_filed = reports_filed + 1 WHERE registry = ? AND attestor = ?", [registry, str(r.attestor)]);
      return;
    }
    case "report_disputed": {
      const prev = int(d.report);
      const by = int(d.by);
      if (prev === null || by === null) return;
      await db.run("UPDATE reports SET state = 'disputed', disputed_by = ? WHERE registry = ? AND id = ?", [by, registry, prev]);
      await db.run("UPDATE reports SET state = 'disputed', disputed_by = ? WHERE registry = ? AND id = ?", [prev, registry, by]);
      return;
    }
    case "report_ruled": {
      const winner = int(d.winner);
      const loser = int(d.loser);
      if (winner !== null) await db.run("UPDATE reports SET state = 'verified' WHERE registry = ? AND id = ?", [registry, winner]);
      if (loser !== null) await db.run("UPDATE reports SET state = 'rejected' WHERE registry = ? AND id = ?", [registry, loser]);
      const a = (await db.query("SELECT slashed FROM attestors WHERE registry = ? AND attestor = ?", [registry, str(d.attestor)]))[0] as Row | undefined;
      if (a) await db.run("UPDATE attestors SET bond = '0', slashed = ? WHERE registry = ? AND attestor = ?", [(big(a.slashed) + big(d.slashed)).toString(), registry, str(d.attestor)]);
      return;
    }
    case "freeze_pushed":
      await freeze(db, chain, registry, str(d.target), "pushed", null, int(d.from), int(d.to), null);
      return;
    case "freeze_lifted":
      await freeze(db, chain, registry, str(d.target), "lifted", null, null, null, false);
      return;

    // ---- registry: attestors ----
    case "attestor_registered": {
      const who = str(d.attestor);
      if (!who) return;
      // The registry sets the first heartbeat to the registration block.
      await db.run(`INSERT INTO attestors (seq, registry, attestor, signing_key, bond, registered_block, last_heartbeat_block, block, timestamp_ms, tx_hash, receipt_id)
         VALUES ($seq, $registry, $attestor, $key, $bond, $block, $block, $block, $ts, $tx, $receipt) ON CONFLICT DO NOTHING`, { ...chain, $registry: registry, $attestor: who, $key: str(d.signing_key), $bond: str(d.bond) ?? "0" });
      return;
    }
    case "attestor_key_rotated":
      await db.run("UPDATE attestors SET signing_key = ? WHERE registry = ? AND attestor = ?", [str(d.after), registry, str(d.attestor)]);
      return;
    case "heartbeat": {
      const who = str(d.attestor);
      if (!who) return;
      const at = int(d.block) ?? rec.block;
      await db.run("INSERT INTO heartbeats (seq, registry, attestor, heartbeat_block, block, timestamp_ms, tx_hash, receipt_id) VALUES ($seq, $registry, $attestor, $at, $block, $ts, $tx, $receipt)", { ...chain, $registry: registry, $attestor: who, $at: at });
      await db.run("UPDATE attestors SET last_heartbeat_block = ? WHERE registry = ? AND attestor = ?", [at, registry, who]);
      return;
    }
    case "attestor_assigned": {
      const target = str(d.target);
      const who = str(d.attestor);
      if (target && who) await db.run("INSERT INTO assignments (registry, target, attestor, seq) VALUES (?, ?, ?, ?) ON CONFLICT (registry, target) DO UPDATE SET attestor = EXCLUDED.attestor, seq = EXCLUDED.seq", [registry, target, who, seq]);
      return;
    }

    // ---- registry: classes ----
    case "target_classified": {
      const target = str(d.target);
      const r = obj(d.record);
      if (!target || !r) return;
      const prev = (await db.query("SELECT class FROM classes WHERE registry = ? AND target = ? ORDER BY seq DESC LIMIT 1", [registry, target]))[0] as Row | undefined;
      await db.run(`INSERT INTO classes (seq, registry, target, class, previous_class, evidence_hash, classified_at_block, classifier, frozen, resolved_code_hash, upgrade_authority, block, timestamp_ms, tx_hash, receipt_id)
         VALUES ($seq, $registry, $target, $class, $previous, $evidence, $at, $classifier, $frozen, $resolved, $authority, $block, $ts, $tx, $receipt)`, {
        ...chain,
        $registry: registry,
        $target: target,
        $class: str(r.class),
        $previous: str(prev?.class),
        $evidence: str(r.evidence_hash),
        $at: int(r.classified_at_block),
        $classifier: str(r.classifier),
        $frozen: r.frozen === true ? 1 : 0,
        $resolved: str(r.resolved_code_hash),
        $authority: str(r.upgrade_authority),
      });
      return;
    }
  }
}

/** One freeze row. `frozen` null means "unchanged": a push is only possible on a frozen target. */
async function freeze(
  db: Queryable,
  chain: { $seq: number; $block: number; $ts: number; $tx: string; $receipt: string },
  registry: string,
  target: string | null,
  kind: "frozen" | "pushed" | "lifted",
  reportId: number | null,
  from: number | null,
  to: number | null,
  frozen: boolean | null,
): Promise<void> {
  if (!target) return;
  const last = (await db.query("SELECT frozen_after FROM freezes WHERE registry = ? AND target = ? ORDER BY seq DESC LIMIT 1", [registry, target]))[0] as Row | undefined;
  const after = frozen ?? (last ? Number(last.frozen_after) === 1 : true);
  await db.run(`INSERT INTO freezes (seq, registry, target, kind, report_id, from_index, to_index, frozen_after, block, timestamp_ms, tx_hash, receipt_id)
     VALUES ($seq, $registry, $target, $kind, $report, $from, $to, $after, $block, $ts, $tx, $receipt)`, { ...chain, $registry: registry, $target: target, $kind: kind, $report: reportId, $from: from, $to: to, $after: after ? 1 : 0 });
}
