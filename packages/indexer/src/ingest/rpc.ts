// Blocks from a NEAR JSON-RPC archive node, such as a QuickNode testnet endpoint (plan KTD1). An RPC node has no
// "every receipt of a block" call, so a block is read in two phases (see BlockSource in neardata.ts):
//
//   scan    one `EXPERIMENTAL_changes_in_block` call lists every account the block touched. A block that touches
//           no watched account costs this one call and nothing more.
//   expand  for the watched accounts only: the receipts that changed them (`EXPERIMENTAL_changes`), each receipt's
//           transaction (`EXPERIMENTAL_receipt_to_tx`), and that transaction's outcomes with their logs
//           (`EXPERIMENTAL_tx_status`). The result has the shape of a NEAR Data block, so one parser serves both.
//
// An event is only seen if the receipt that logged it changed the account's state. Every Aruna contract emits from
// a `&mut self` method, which writes its state, and the tests replay recorded testnet blocks to check this holds.

import { sleep } from "../sleep.js";
import type { BlockSource, NeardataBlock, ReceiptOutcome } from "./neardata.js";

export interface RpcScan {
  height: number;
  /** Distinct accounts whose account record or contract data changed in this block. */
  touched: string[];
}

interface RpcErrorBody {
  name?: string;
  code?: number;
  message?: string;
  cause?: { name?: string };
}

/** The endpoint is on another network. Not a passing failure: a retry or another check will not change it. */
export class WrongNetworkError extends Error {
  constructor(chainId: string) {
    super(`the RPC endpoint is on ${chainId}; the indexer runs on testnet only`);
    this.name = "WrongNetworkError";
  }
}

/** The node answered with a JSON-RPC error that retrying will not fix, or exhausted the retries. */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly cause_name?: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

interface TxStatus {
  transaction: { signer_id: string; receiver_id: string; actions: unknown[] };
  transaction_outcome: { outcome: { receipt_ids: string[] } };
  receipts: Array<{ receipt_id: string; predecessor_id: string; receiver_id: string; receipt: Record<string, unknown> }>;
  receipts_outcome: Array<{ id: string; block_hash: string; outcome: { executor_id: string; logs: string[]; status: Record<string, unknown> | string } }>;
}

/** The node does not hold this block (it prunes old blocks, as dRPC does), so another source must read it. */
export class BlockNotServedError extends Error {
  constructor(readonly height: number) {
    super(`block ${height} is not held by this node`);
    this.name = "BlockNotServedError";
  }
}

const TX_CACHE_SIZE = 256;
/** Later heights tried when proving a skip; consecutive skipped heights longer than this are not seen on testnet. */
const SKIP_PROOF_SPAN = 3;
const RETRYABLE_RPC_ERRORS = new Set(["TIMEOUT_ERROR", "INTERNAL_ERROR"]);

export interface RpcSourceOptions {
  /** The full endpoint URL. A QuickNode URL carries its token in the path, so it is a secret: it is never logged. */
  url: string;
  fetch?: typeof globalThis.fetch;
  retries?: number;
  backoffMs?: number;
  /** A request still unanswered after this long is abandoned and retried (default 30 s). */
  timeoutMs?: number;
  /**
   * Set for a node that prunes old blocks. Such a node answers UNKNOWN_BLOCK both for a height the chain skipped
   * and for one it no longer holds, so a skip is accepted only when a later block's `prev_height` proves it.
   * An archive node holds every block, so its UNKNOWN_BLOCK already means a skip.
   */
  proveSkips?: boolean;
}

/** An RPC block source, plus the earliest height the node still holds. */
export interface RpcBlockSource extends BlockSource<RpcScan> {
  earliestHeight(): Promise<number>;
}

export function rpcSource(o: RpcSourceOptions): RpcBlockSource {
  const doFetch = o.fetch ?? globalThis.fetch.bind(globalThis);
  const retries = o.retries ?? 6;
  const backoff = o.backoffMs ?? 500;
  const timeoutMs = o.timeoutMs ?? 30_000;

  let endpoint: URL;
  try {
    endpoint = new URL(o.url);
  } catch {
    // The value is not echoed: if it is only a token, printing it would leak it.
    throw new Error("QUICKNODE_RPC_URL is not a URL. It needs the full endpoint URL from the QuickNode dashboard (HTTP Provider), https://<name>.<network>.quiknode.pro/<token>/, not only the token.");
  }

  // Every message that leaves this file goes through redact, so the token in the URL cannot reach a log.
  const secrets = [o.url, ...endpoint.pathname.split("/").filter((s) => s.length >= 6), endpoint.search].filter(Boolean);
  const redact = (text: string) => secrets.reduce((t, s) => t.split(s).join("<rpc>"), text);

  async function rpc<T>(method: string, params: unknown): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res: Response | undefined;
      try {
        res = await doFetch(o.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const body = (await res.json()) as { result?: T; error?: RpcErrorBody };
          if (body.error === undefined) return body.result as T;
          const name = body.error.cause?.name ?? body.error.name ?? "";
          const err = new RpcError(redact(`${method} failed: ${name || body.error.message || "error"}`), method, name);
          if (body.error.code !== -429 && !RETRYABLE_RPC_ERRORS.has(name)) throw err;
          last = err;
        }
      } catch (e) {
        if (e instanceof RpcError) throw e;
        last = new Error(redact(`${method} could not be read: ${e instanceof Error ? e.message : String(e)}`));
      }
      if (res && !res.ok) {
        await res.body?.cancel();
        last = new Error(`${method} answered HTTP ${res.status}`);
        // A rejected token (401, 403) or a wrong path does not get better with a retry; a rate limit or a 5xx might.
        if (res.status !== 429 && res.status < 500) throw last;
      }
      if (attempt < retries) await sleep(backoff * 2 ** attempt);
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  // The indexer runs on testnet only (CLAUDE.md rule 3); an endpoint on another network fails before any read.
  // A failed check is forgotten, so a source benched for a passing outage can be used again; a wrong network is not.
  let verified: Promise<void> | undefined;
  const ready = () =>
    (verified ??= rpc<{ chain_id: string }>("status", []).then(
      (s) => {
        if (s.chain_id !== "testnet") throw new WrongNetworkError(s.chain_id);
      },
      (e: unknown) => {
        verified = undefined;
        throw e;
      },
    ));

  /** Whether `height` was skipped by the chain, judged from the next block this node holds. */
  async function provenSkipped(height: number): Promise<boolean> {
    for (let next = height + 1; next <= height + SKIP_PROOF_SPAN; next++) {
      try {
        const { header } = await rpc<{ header: { prev_height?: number } }>("block", { block_id: next });
        return typeof header.prev_height === "number" && header.prev_height < height;
      } catch (e) {
        if (e instanceof RpcError && e.cause_name === "UNKNOWN_BLOCK") continue;
        throw e;
      }
    }
    return false;
  }

  const txCache = new Map<string, Promise<TxStatus>>();
  const txStatus = (hash: string, sender: string): Promise<TxStatus> => {
    let hit = txCache.get(hash);
    if (!hit) {
      hit = rpc<TxStatus>("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
      hit.catch(() => txCache.delete(hash));
      txCache.set(hash, hit);
      if (txCache.size > TX_CACHE_SIZE) txCache.delete(txCache.keys().next().value as string);
    }
    return hit;
  };

  async function outcomeOf(receiptId: string, height: number, blockHash: string): Promise<ReceiptOutcome> {
    const tx = await rpc<{ transaction_hash: string; sender_account_id: string }>("EXPERIMENTAL_receipt_to_tx", { receipt_id: receiptId, block_height: height });
    const status = await txStatus(tx.transaction_hash, tx.sender_account_id);
    const outcome = status.receipts_outcome.find((x) => x.id === receiptId);
    if (!outcome) throw new Error(`transaction ${tx.transaction_hash} has no outcome for receipt ${receiptId}`);
    if (outcome.block_hash !== blockHash) throw new Error(`receipt ${receiptId} was executed in block ${outcome.block_hash}, not ${blockHash}`);

    // A transaction signed by the account it calls becomes its first receipt in the same block, and RPC lists
    // that receipt only as the transaction itself.
    let receipt = status.receipts.find((r) => r.receipt_id === receiptId);
    if (!receipt && status.transaction_outcome.outcome.receipt_ids[0] === receiptId) {
      receipt = {
        receipt_id: receiptId,
        predecessor_id: status.transaction.signer_id,
        receiver_id: status.transaction.receiver_id,
        receipt: { Action: { actions: status.transaction.actions } },
      };
    }
    if (!receipt) throw new Error(`transaction ${tx.transaction_hash} does not list receipt ${receiptId}`);
    return { tx_hash: tx.transaction_hash, receipt, execution_outcome: { id: outcome.id, block_hash: outcome.block_hash, outcome: outcome.outcome } };
  }

  return {
    async block(height) {
      await ready();
      try {
        const { changes } = await rpc<{ changes: Array<{ type: string; account_id: string }> }>("EXPERIMENTAL_changes_in_block", { block_id: height });
        const touched = new Set(changes.filter((c) => c.type === "account_touched" || c.type === "data_touched").map((c) => c.account_id));
        return { height, touched: [...touched] };
      } catch (e) {
        if (!(e instanceof RpcError && e.cause_name === "UNKNOWN_BLOCK")) throw e;
        if (!o.proveSkips || (await provenSkipped(height))) return null;
        throw new BlockNotServedError(height);
      }
    },

    async expand(scan, watched) {
      const accounts = scan.touched.filter(watched);
      if (accounts.length === 0) return { block: { header: { height: scan.height, hash: "", timestamp_nanosec: "0" } }, shards: [] };

      const { header } = await rpc<{ header: NeardataBlock["block"]["header"] }>("block", { block_id: scan.height });
      // A receipt can change an account's record without writing its data, or the reverse, so ask for both.
      const [account, data] = await Promise.all([
        rpc<{ changes: Array<{ cause: { type: string; receipt_hash?: string } }> }>("EXPERIMENTAL_changes", { changes_type: "account_changes", account_ids: accounts, block_id: scan.height }),
        rpc<{ changes: Array<{ cause: { type: string; receipt_hash?: string } }> }>("EXPERIMENTAL_changes", { changes_type: "data_changes", account_ids: accounts, key_prefix_base64: "", block_id: scan.height }),
      ]);
      const receiptIds = [...new Set([...account.changes, ...data.changes].map((c) => c.cause).filter((c) => c.type === "receipt_processing").map((c) => c.receipt_hash as string))].sort();

      const outcomes: ReceiptOutcome[] = [];
      for (const id of receiptIds) outcomes.push(await outcomeOf(id, scan.height, header.hash));
      return { block: { header: { height: header.height, hash: header.hash, timestamp_nanosec: header.timestamp_nanosec } }, shards: [{ receipt_execution_outcomes: outcomes }] };
    },

    async earliestHeight() {
      await ready();
      const s = await rpc<{ sync_info: { earliest_block_height: number } }>("status", []);
      return s.sync_info.earliest_block_height;
    },

    async finalHeight() {
      await ready();
      const { header } = await rpc<{ header: { height: number } }>("block", { finality: "final" });
      return header.height;
    },
  };
}
