// Turns one neardata block into raw records (plan U2, KTD2, KTD3): the aruna events of watched,
// successful receipts, the create_vault arguments of watched factories, and anything unrecognised kept
// as `unparsed` so it is reported rather than dropped (R4).

import type { NeardataBlock, ReceiptOutcome } from "./blocks.js";
import type { WatchSet } from "./watch.js";

export interface RawRecord {
  kind: "event" | "call" | "unparsed";
  contract: string;
  /** Event or method name; null when a line could not be parsed at all. */
  name: string | null;
  data: Record<string, unknown>;
  block: number;
  timestamp_ms: number;
  tx_hash: string;
  receipt_id: string;
  /** Position of the log line in its receipt; for a call record, -(action index + 1). */
  idx: number;
}

const PREFIX = "EVENT_JSON:";

/** Every event Aruna's contracts emit, with the fields the indexer derives from. An event missing one
 * of its fields is kept as unparsed. */
const KNOWN: Record<string, readonly string[]> = {
  // vault
  agent_registered: ["public_key"],
  agent_status_changed: ["public_key"],
  policy_updated: ["public_key"],
  class_refreshed: ["target"],
  target_frozen: ["target"],
  ceiling_updated: [],
  operator_changed: ["after"],
  owner_changed: ["after"],
  withdrawal: ["amount"],
  deposit: ["amount"],
  execution_allowed: ["agent", "target", "amount"],
  execution_rejected: ["agent", "reason"],
  execution_failed: ["agent", "target"],
  exposure_recorded: ["agent", "target", "amount", "total"],
  agent_auto_disabled: ["agent"],
  // factory
  vault_version_set: [],
  vault_creation_failed: ["vault"],
  vault_created: ["vault", "owner", "code_hash"],
  // registry
  classifier_added: [],
  classifier_removed: [],
  factory_set: [],
  target_classified: ["target"],
  vault_deployed: ["vault"],
  vault_code_hash_allowed: [],
  arbiter_set: [],
  pool_set: [],
  attestor_assigned: ["target", "attestor"],
  attestor_registered: ["attestor"],
  attestor_key_rotated: ["attestor"],
  heartbeat: ["attestor"],
  drift_reported: ["id", "report"],
  report_disputed: ["report"],
  report_ruled: ["winner", "loser"],
  freeze_pushed: ["target"],
  freeze_lifted: ["target"],
  // pool
  capital_deposited: ["underwriter"],
  capital_withdrawn: ["underwriter"],
  slash_received: ["attestor"],
  coverage_refused: ["buyer"],
  coverage_purchased: ["coverage"],
  coverage_released: ["coverage"],
  claim_paid: ["coverage", "report"],
  claim_rejected: ["coverage", "report"],
};

const succeeded = (o: ReceiptOutcome) => {
  const s = o.execution_outcome.outcome.status;
  return typeof s === "object" && s !== null && ("SuccessValue" in s || "SuccessReceiptId" in s);
};

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function decodeArgs(b64: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractRecords(block: NeardataBlock, watch: WatchSet): RawRecord[] {
  const height = block.block.header.height;
  const timestamp_ms = Number(BigInt(block.block.header.timestamp_nanosec) / 1_000_000n);
  const out: RawRecord[] = [];

  for (const shard of block.shards) {
    for (const o of shard.receipt_execution_outcomes ?? []) {
      const contract = o.execution_outcome.outcome.executor_id;
      if (!watch.has(contract) || !succeeded(o)) continue;
      const base = { contract, block: height, timestamp_ms, tx_hash: o.tx_hash ?? "", receipt_id: o.execution_outcome.id };

      if (watch.isFactory(contract)) {
        const inner = o.receipt?.receipt;
        const actions = isObject(inner) && isObject(inner.Action) && Array.isArray(inner.Action.actions) ? inner.Action.actions : [];
        actions.forEach((a, i) => {
          if (!isObject(a) || !isObject(a.FunctionCall) || a.FunctionCall.method_name !== "create_vault") return;
          const args = decodeArgs(String(a.FunctionCall.args ?? ""));
          if (args) out.push({ ...base, kind: "call", name: "create_vault", data: args, idx: -(i + 1) });
        });
      }

      o.execution_outcome.outcome.logs.forEach((line, idx) => {
        if (!line.startsWith(PREFIX)) return;
        let body: unknown;
        try {
          body = JSON.parse(line.slice(PREFIX.length));
        } catch {
          out.push({ ...base, kind: "unparsed", name: null, data: { line }, idx });
          return;
        }
        if (!isObject(body) || body.standard !== "aruna") return;
        const name = typeof body.event === "string" ? body.event : null;
        const items = Array.isArray(body.data) ? body.data : null;
        const required = name !== null ? KNOWN[name] : undefined;
        const data = items && items.length === 1 && isObject(items[0]) ? items[0] : null;
        if (!required || !data || required.some((f) => !(f in data))) {
          out.push({ ...base, kind: "unparsed", name, data: { line }, idx });
          return;
        }
        out.push({ ...base, kind: "event", name: name!, data, idx });
        if (name === "vault_created" && watch.isFactory(contract) && typeof data.vault === "string") watch.addVault(data.vault, contract);
      });
    }
  }
  return out;
}
