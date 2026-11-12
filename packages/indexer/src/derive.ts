// Derived tables are a pure function of the raw records, applied in seq order (plan KTD3). Rebuilding
// replays the same records and gets the same rows. Nothing here reads the chain.

import type { DatabaseSync } from "node:sqlite";
import type { ActivityKind, TokenKey } from "./api.js";
import { applyCoverageAndDrift } from "./derive-coverage.js";
import type { RawRecord } from "./ingest/parse.js";

const KIND: Record<string, ActivityKind> = {
  execution_allowed: "allowed",
  execution_rejected: "refused",
  execution_failed: "failed",
  exposure_recorded: "exposure",
  agent_auto_disabled: "auto_disabled",
  agent_registered: "agent_registered",
  agent_status_changed: "status_changed",
  policy_updated: "policy_updated",
  class_refreshed: "class_refreshed",
  target_frozen: "target_frozen",
  deposit: "deposit",
  withdrawal: "withdrawal",
  ceiling_updated: "ceiling_updated",
  operator_changed: "operator_changed",
  owner_changed: "owner_changed",
};

/** Spend events from vaults before tokens (v1, v2) carry no `token`: they are NEAR. */
const SPEND_EVENTS = new Set(["execution_allowed", "execution_failed", "exposure_recorded"]);

const obj = (x: unknown): Record<string, unknown> | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);

export function tokenKey(event: string, raw: unknown): TokenKey | null {
  if (raw === undefined || raw === null) return SPEND_EVENTS.has(event) ? "near" : null;
  if (raw === "near") return "near";
  const ft = obj(raw)?.ft;
  return typeof ft === "string" ? ft : null;
}

function refs(rec: RawRecord) {
  const d = rec.data;
  const coverage = obj(d.coverage);
  const report = obj(d.report);
  return {
    target: str(d.target) ?? str(report?.target) ?? str(coverage?.target),
    attestor: str(d.attestor) ?? str(report?.attestor),
    coverage: typeof d.coverage === "number" ? d.coverage : typeof coverage?.id === "number" ? coverage.id : null,
    vault: str(d.vault) ?? str(coverage?.vault),
  };
}

export function applyRecord(db: DatabaseSync, seq: number, rec: RawRecord): void {
  const chain = { $seq: seq, $block: rec.block, $ts: rec.timestamp_ms, $tx: rec.tx_hash, $receipt: rec.receipt_id };
  const d = rec.data;

  if (rec.kind === "call" && rec.name === "create_vault") {
    const name = str(d.name);
    if (!name) return;
    // Anyone may call create_vault for any name, so a call is tied to a vault only through its own transaction.
    db.prepare("INSERT OR REPLACE INTO creates (vault, tx_hash, owner, operator, seq) VALUES ($vault, $tx, $owner, $operator, $seq)").run({
      $vault: `${name}.${rec.contract}`,
      $tx: rec.tx_hash,
      $owner: str(d.owner),
      $operator: str(d.operator),
      $seq: seq,
    });
    return;
  }
  if (rec.kind !== "event" || rec.name === null) return;
  const event = rec.name;

  const isVault = db.prepare("SELECT 1 FROM vaults WHERE vault = ?").get(rec.contract) !== undefined;
  const r = refs(rec);
  db.prepare(
    "INSERT INTO events (seq, contract, event, block, timestamp_ms, tx_hash, receipt_id, data, ref_vault, ref_target, ref_attestor, ref_coverage) VALUES ($seq, $contract, $event, $block, $ts, $tx, $receipt, $data, $vault, $target, $attestor, $coverage)",
  ).run({ ...chain, $contract: rec.contract, $event: event, $data: JSON.stringify(d), $vault: isVault ? rec.contract : r.vault, $target: r.target, $attestor: r.attestor, $coverage: r.coverage });

  if (event === "vault_created") {
    const vault = str(d.vault)!;
    const create = db.prepare("SELECT operator FROM creates WHERE vault = ? AND tx_hash = ?").get(vault, rec.tx_hash) as { operator: string | null } | undefined;
    db.prepare(
      "INSERT OR REPLACE INTO vaults (vault, factory, owner, operator, code_hash, created_block, created_tx, seq) VALUES ($vault, $factory, $owner, $operator, $code_hash, $block, $tx, $seq)",
    ).run({ $vault: vault, $factory: rec.contract, $owner: str(d.owner), $operator: create?.operator ?? null, $code_hash: str(d.code_hash), $block: rec.block, $tx: rec.tx_hash, $seq: seq });
    return;
  }

  if (!isVault) {
    // Pools and registries: coverage, claims, drift reports, freezes, attestors and classes (R7).
    applyCoverageAndDrift(db, seq, rec);
    return;
  }
  if (event === "owner_changed") db.prepare("UPDATE vaults SET owner = ? WHERE vault = ?").run(str(d.after), rec.contract);
  if (event === "operator_changed") db.prepare("UPDATE vaults SET operator = ? WHERE vault = ?").run(str(d.after), rec.contract);

  const token = tokenKey(event, d.token);
  const cached = obj(d.cached);
  db.prepare(
    "INSERT INTO activity (seq, vault, agent, kind, event, target, amount, token, reason, class, block, timestamp_ms, tx_hash, receipt_id, data) VALUES ($seq, $vault, $agent, $kind, $event, $target, $amount, $token, $reason, $class, $block, $ts, $tx, $receipt, $data)",
  ).run({
    ...chain,
    $vault: rec.contract,
    $agent: str(d.agent) ?? str(d.public_key),
    $kind: KIND[event] ?? "other",
    $event: event,
    $target: str(d.target),
    $amount: str(d.amount),
    $token: token,
    $reason: str(d.reason),
    $class: str(d.class) ?? str(cached?.class),
    $data: JSON.stringify(d),
  });

  if (event === "exposure_recorded") {
    db.prepare(
      "INSERT INTO exposure (seq, vault, agent, target, token, amount, total, class, block, timestamp_ms, tx_hash, receipt_id) VALUES ($seq, $vault, $agent, $target, $token, $amount, $total, $class, $block, $ts, $tx, $receipt)",
    ).run({ ...chain, $vault: rec.contract, $agent: str(d.agent), $target: str(d.target), $token: token, $amount: str(d.amount), $total: str(d.total), $class: str(d.class) });
  }
}
