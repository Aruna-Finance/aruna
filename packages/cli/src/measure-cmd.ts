// Batch classification for the mainnet measurement (docs/CLASSIFIER.md "The headline measurement").
// Read-only. Failed reads are listed apart and never counted as `unknown`.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classify } from "@aruna/classifier-core";
import type { Classification, MutabilityBasis, RiskClass, RpcReader } from "@aruna/classifier-core";

export interface AccountRow {
  accountId: string;
  /** Call count from the source query, when the input carries one. */
  calls: number | null;
}

export type MeasureResult =
  | { accountId: string; calls: number | null; ok: true; classification: Classification }
  | { accountId: string; calls: number | null; ok: false; error: string };

const ACCOUNT_COLUMNS = ["account_id", "receipt_receiver_account_id", "receiver_account_id"];
const CALL_COLUMNS = ["calls", "call_count", "function_calls", "n"];

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, "$1");

export function parseAccountsCsv(text: string): AccountRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => unquote(h).toLowerCase());
  const idCol = header.findIndex((h) => ACCOUNT_COLUMNS.includes(h));
  if (idCol < 0) throw new Error(`no account column: expected one of ${ACCOUNT_COLUMNS.join(", ")} (account_id preferred)`);
  const callCol = header.findIndex((h) => CALL_COLUMNS.includes(h));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map(unquote);
    const calls = callCol >= 0 && cells[callCol] !== undefined && cells[callCol] !== "" ? Number(cells[callCol]) : null;
    return { accountId: cells[idCol], calls: calls !== null && Number.isFinite(calls) ? calls : null };
  });
}

export interface MeasureOptions {
  concurrency: number;
  /** Extra attempts per account after the reader's own endpoint fallback has failed. */
  retries: number;
  backoffMs?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function runMeasure(rows: AccountRow[], reader: RpcReader, opts: MeasureOptions): Promise<MeasureResult[]> {
  const results: MeasureResult[] = new Array(rows.length);
  let next = 0;
  let done = 0;
  const backoff = opts.backoffMs ?? 1000;

  async function one(row: AccountRow): Promise<MeasureResult> {
    let lastError = "";
    for (let attempt = 0; attempt <= opts.retries; attempt++) {
      try {
        return { ...row, ok: true, classification: await classify(row.accountId, reader) };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (attempt < opts.retries) await new Promise((r) => setTimeout(r, backoff * (attempt + 1)));
      }
    }
    return { ...row, ok: false, error: lastError };
  }

  async function worker() {
    while (next < rows.length) {
      const i = next++;
      results[i] = await one(rows[i]);
      opts.onProgress?.(++done, rows.length);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, rows.length)) }, worker));
  return results;
}

const CLASSES: RiskClass[] = ["immutable_verified", "local_upgradeable", "global_by_account", "unknown"];
const BASES: MutabilityBasis[] = ["no_detected_path", "full_access_key", "upgrade_imports", "own_code", "global_owner", "undetermined"];

const share = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 10_000) / 10_000);

/** Deterministic: depends only on the results, in a fixed key order. */
export function aggregate(results: MeasureResult[]) {
  const classified = results.filter((r): r is Extract<MeasureResult, { ok: true }> => r.ok);
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, classified.filter((r) => r.classification.class === c).length])) as Record<RiskClass, number>;
  const byBasis = Object.fromEntries(
    BASES.map((b) => [b, classified.filter((r) => r.classification.evidence.mutabilityBasis === b).length]),
  ) as Record<MutabilityBasis, number>;
  const heights = classified.map((r) => r.classification.evidence.checkedAtBlock);
  const of = classified.length;
  return {
    total: results.length,
    classified: of,
    failed: results.filter((r) => !r.ok).map((r) => r.accountId),
    byClass,
    byBasis,
    /** Headline 1: share invisible to hash-based monitoring. */
    headline1: { globalByAccount: byClass.global_by_account, of, share: share(byClass.global_by_account, of) },
    /** Headline 2: what can change under an agent at all. upgrade_imports inflates it, so it is kept apart. */
    headline2: {
      canChange: byBasis.full_access_key + byBasis.global_owner + byBasis.own_code,
      immutableVerified: byClass.immutable_verified,
      upgradeImportsReportedSeparately: byBasis.upgrade_imports,
      unknown: byClass.unknown,
      of,
    },
    blockRange: heights.length ? { min: Math.min(...heights), max: Math.max(...heights) } : null,
  };
}

export async function writeMeasurement(dir: string, results: MeasureResult[], meta: Record<string, unknown>) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "results.jsonl"), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await writeFile(join(dir, "aggregate.json"), JSON.stringify(aggregate(results), null, 2) + "\n");
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
}

export async function readAccounts(path: string): Promise<AccountRow[]> {
  return parseAccountsCsv(await readFile(path, "utf8"));
}
