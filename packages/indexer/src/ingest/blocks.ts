// The shape of a block as the indexer reads it, and what a block source is. The field names are those of NEAR Data's
// block JSON (receipt outcomes with their logs and tx hash); the RPC source (rpc.ts) builds the same shape, so a block
// decodes the same whichever endpoint served it.

export interface ReceiptOutcome {
  tx_hash: string | null;
  receipt: {
    predecessor_id?: string;
    receiver_id?: string;
    receipt_id?: string;
    receipt?: { Action?: { actions?: Array<{ FunctionCall?: { method_name: string; args: string } } | string> } } | Record<string, unknown>;
  } | null;
  execution_outcome: {
    id: string;
    block_hash?: string;
    outcome: { executor_id: string; logs: string[]; status: Record<string, unknown> | string };
  };
}

export interface NeardataBlock {
  block: { header: { height: number; hash: string; timestamp_nanosec: string } };
  shards: Array<{ shard_id?: number; receipt_execution_outcomes: ReceiptOutcome[] | null }>;
}

/**
 * Where blocks come from, in two phases. `block` is a cheap read that is safe to run in parallel across a window of
 * heights. `expand` then completes one scanned block into receipt outcomes, and runs in height order at commit time,
 * so it sees the watched set as it stands after every earlier block: a vault created a few blocks ago is already in it.
 * A source that reads whole blocks has nothing left to do in `expand`.
 */
export interface BlockSource<Scanned = NeardataBlock> {
  /** The block at `height`, or null when the chain skipped that height. */
  block(height: number): Promise<Scanned | null>;
  /** The scanned block with the receipt outcomes of the accounts `watched` keeps. */
  expand(scanned: Scanned, watched: (account: string) => boolean): Promise<NeardataBlock>;
  /** The latest final block height. */
  finalHeight(): Promise<number>;
}
