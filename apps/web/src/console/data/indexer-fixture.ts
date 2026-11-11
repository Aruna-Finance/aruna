// Recorded indexer answers for lane B to build against before the live indexer exists (plan U1).
// Every event below is real: read from testnet with the archival RPC for the eight transactions of the
// recorded demo2 runs in examples/README.md (10 November 2026). Shapes are the @aruna/indexer read
// contract, so swapping this client for createIndexerClient changes no screen.
//
// The one value not taken from chain: demo2's creation block and transaction are not in the recorded
// runs, so VAULTS carries 0 and "" there until an indexer export replaces this file.

import type { ActivityItem, EventItem, ExposureRow, IndexerClient, Page, VaultSummary } from "@aruna/indexer/client";

export const FIXTURE_LAST_INDEXED_BLOCK = 277069048;

export const VAULTS: VaultSummary[] = [
  {
    vault: "demo2.factory.arunafi.testnet",
    factory: "factory.arunafi.testnet",
    owner: "demo-client.arunafi.testnet",
    operator: "demo-company.arunafi.testnet",
    code_hash: "4hDwncUDmaMbrde7F95Agj7g4otBVpSeM1evk6JNQSam",
    created_block: 0,
    created_tx: "",
  },
];

export const ACTIVITY: ActivityItem[] = [
  {
    "seq": 1,
    "block": 277068990,
    "timestamp_ms": 1794314618764,
    "tx_hash": "FQG3Ym8DoFPTTstJAzojj6kY2ACnGNgAgryf6A4kweWq",
    "receipt_id": "Ds1jd8oUCfnTsRYNxGjDFgCu8BC7SmQu4Gxksv5js43W",
    "kind": "refused",
    "event": "execution_rejected",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
    "target": "attacker.testnet",
    "amount": null,
    "token": null,
    "reason": "ARUNA_TARGET_NOT_ALLOWED",
    "class": null,
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "attacker.testnet",
      "reason": "ARUNA_TARGET_NOT_ALLOWED",
      "class": null,
      "block": 277068990
    }
  },
  {
    "seq": 2,
    "block": 277068996,
    "timestamp_ms": 1794314622118,
    "tx_hash": "9KVsPajkeFzqXuRU4QT3d6TEmxhfqHiUpmy1HULm55X7",
    "receipt_id": "HcHMCMQjX5sE1zy5nZTAbNiRqjscXRYDKGSnCnpGi4e4",
    "kind": "refused",
    "event": "execution_rejected",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
    "target": "swap.arunafi.testnet",
    "amount": null,
    "token": null,
    "reason": "ARUNA_MAX_PER_TX_EXCEEDED",
    "class": "local_upgradeable",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "swap.arunafi.testnet",
      "reason": "ARUNA_MAX_PER_TX_EXCEEDED",
      "class": "local_upgradeable",
      "block": 277068996
    }
  },
  {
    "seq": 3,
    "block": 277069002,
    "timestamp_ms": 1794314625718,
    "tx_hash": "HF3Lnoodi81yF39cm94hQFZF6Ly2w3YFU5SW2Daqsnmv",
    "receipt_id": "6mGoBdM36hLWDdNpeKZ5AzdyXnP8jhfhaA9kcfmjTm66",
    "kind": "refused",
    "event": "execution_rejected",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
    "target": "swap.arunafi.testnet",
    "amount": null,
    "token": null,
    "reason": "ARUNA_SLIPPAGE_TOO_HIGH",
    "class": "local_upgradeable",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "swap.arunafi.testnet",
      "reason": "ARUNA_SLIPPAGE_TOO_HIGH",
      "class": "local_upgradeable",
      "block": 277069002
    }
  },
  {
    "seq": 4,
    "block": 277069008,
    "timestamp_ms": 1794314629207,
    "tx_hash": "46oPP5KLp3yVoWX1dNqLYUnJsjto5H4tEnRduh1R1zgK",
    "receipt_id": "EEM8wtPvHobvBwFfWJ272Zxy7ZT1cEbU3wzR9VeskD6v",
    "kind": "refused",
    "event": "execution_rejected",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
    "target": "attacker.testnet",
    "amount": null,
    "token": null,
    "reason": "ARUNA_TARGET_NOT_ALLOWED",
    "class": null,
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "attacker.testnet",
      "reason": "ARUNA_TARGET_NOT_ALLOWED",
      "class": null,
      "block": 277069008
    }
  },
  {
    "seq": 5,
    "block": 277069014,
    "timestamp_ms": 1794314632822,
    "tx_hash": "BxUgGjgxEG8JcojAZ1HC8upQDDw2ud4MkVUthx8euczL",
    "receipt_id": "5DPQS341eDe9RWJZwRQ6MByy8nFQiC1uQ9bm6urWpj97",
    "kind": "refused",
    "event": "execution_rejected",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
    "target": "attacker-2.testnet",
    "amount": null,
    "token": null,
    "reason": "ARUNA_TARGET_NOT_ALLOWED",
    "class": null,
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "attacker-2.testnet",
      "reason": "ARUNA_TARGET_NOT_ALLOWED",
      "class": null,
      "block": 277069014
    }
  },
  {
    "seq": 6,
    "block": 277069014,
    "timestamp_ms": 1794314632822,
    "tx_hash": "BxUgGjgxEG8JcojAZ1HC8upQDDw2ud4MkVUthx8euczL",
    "receipt_id": "5DPQS341eDe9RWJZwRQ6MByy8nFQiC1uQ9bm6urWpj97",
    "kind": "auto_disabled",
    "event": "agent_auto_disabled",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
    "target": null,
    "amount": null,
    "token": null,
    "reason": null,
    "class": null,
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "weighted_refusals": 28,
      "window_blocks": 1200
    }
  },
  {
    "seq": 7,
    "block": 277069020,
    "timestamp_ms": 1794314636451,
    "tx_hash": "CEZkfcTGSNSk2duqChy5Wc3SgyTFBAS7EJaTwapgBBLa",
    "receipt_id": "8vBZhWFVGm1G1D3pREsLw8rYSgpFWGD8aTFfzgi99UnC",
    "kind": "refused",
    "event": "execution_rejected",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
    "target": "swap.arunafi.testnet",
    "amount": null,
    "token": null,
    "reason": "ARUNA_AGENT_AUTO_DISABLED",
    "class": "local_upgradeable",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "swap.arunafi.testnet",
      "reason": "ARUNA_AGENT_AUTO_DISABLED",
      "class": "local_upgradeable",
      "block": 277069020
    }
  },
  {
    "seq": 8,
    "block": 277069040,
    "timestamp_ms": 1794314648700,
    "tx_hash": "At17sV6yJpARbtH9w4rPkT5w3qpATRxcddfeqZ1ALLrZ",
    "receipt_id": "Eg5RVhwq3Ckwa7464do6ZkDfKLG1s6TxZPP7MKu3QrcP",
    "kind": "class_refreshed",
    "event": "class_refreshed",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": null,
    "target": "swap.arunafi.testnet",
    "amount": null,
    "token": null,
    "reason": null,
    "class": "local_upgradeable",
    "data": {
      "target": "swap.arunafi.testnet",
      "cached": {
        "class": "local_upgradeable",
        "frozen": false,
        "classified_at_block": 277068570,
        "fetched_at_block": 277069040
      }
    }
  },
  {
    "seq": 9,
    "block": 277069046,
    "timestamp_ms": 1794314652271,
    "tx_hash": "BqTxFWwXCSmFqkKeQawS8gm8YhpGu9Hwv9qqqJaXuHnJ",
    "receipt_id": "BgHGUbQ1Z1FsRBqZu8fcEFSTXYnttovji9k2mKye7Zyk",
    "kind": "allowed",
    "event": "execution_allowed",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:7THAYJHPStMpR3xZjiKoHDdBu6ChQWfG6w93r9sUxHFi",
    "target": "swap.arunafi.testnet",
    "amount": "100000000000000000000000",
    "token": "near",
    "reason": null,
    "class": "local_upgradeable",
    "data": {
      "agent": "ed25519:7THAYJHPStMpR3xZjiKoHDdBu6ChQWfG6w93r9sUxHFi",
      "adapter": "swap",
      "target": "swap.arunafi.testnet",
      "amount": "100000000000000000000000",
      "class": "local_upgradeable"
    }
  },
  {
    "seq": 10,
    "block": 277069048,
    "timestamp_ms": 1794314653605,
    "tx_hash": "BqTxFWwXCSmFqkKeQawS8gm8YhpGu9Hwv9qqqJaXuHnJ",
    "receipt_id": "65JqwxhNbovjRf3cJvt7XFYaBbNLmi95w1KudJMsZfrX",
    "kind": "exposure",
    "event": "exposure_recorded",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:7THAYJHPStMpR3xZjiKoHDdBu6ChQWfG6w93r9sUxHFi",
    "target": "swap.arunafi.testnet",
    "amount": "100000000000000000000000",
    "token": "near",
    "reason": null,
    "class": "local_upgradeable",
    "data": {
      "agent": "ed25519:7THAYJHPStMpR3xZjiKoHDdBu6ChQWfG6w93r9sUxHFi",
      "target": "swap.arunafi.testnet",
      "amount": "100000000000000000000000",
      "class": "local_upgradeable",
      "total": "200000000000000000000000"
    }
  }
];

export const EXPOSURE: ExposureRow[] = [
  {
    "seq": 10,
    "block": 277069048,
    "timestamp_ms": 1794314653605,
    "tx_hash": "BqTxFWwXCSmFqkKeQawS8gm8YhpGu9Hwv9qqqJaXuHnJ",
    "receipt_id": "65JqwxhNbovjRf3cJvt7XFYaBbNLmi95w1KudJMsZfrX",
    "vault": "demo2.factory.arunafi.testnet",
    "agent": "ed25519:7THAYJHPStMpR3xZjiKoHDdBu6ChQWfG6w93r9sUxHFi",
    "target": "swap.arunafi.testnet",
    "token": "near",
    "amount": "100000000000000000000000",
    "total": "200000000000000000000000",
    "class": "local_upgradeable"
  }
];

export const EVENTS: EventItem[] = [
  {
    "seq": 1,
    "block": 277068990,
    "timestamp_ms": 1794314618764,
    "tx_hash": "FQG3Ym8DoFPTTstJAzojj6kY2ACnGNgAgryf6A4kweWq",
    "receipt_id": "Ds1jd8oUCfnTsRYNxGjDFgCu8BC7SmQu4Gxksv5js43W",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "execution_rejected",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "attacker.testnet",
      "reason": "ARUNA_TARGET_NOT_ALLOWED",
      "class": null,
      "block": 277068990
    }
  },
  {
    "seq": 2,
    "block": 277068996,
    "timestamp_ms": 1794314622118,
    "tx_hash": "9KVsPajkeFzqXuRU4QT3d6TEmxhfqHiUpmy1HULm55X7",
    "receipt_id": "HcHMCMQjX5sE1zy5nZTAbNiRqjscXRYDKGSnCnpGi4e4",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "execution_rejected",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "swap.arunafi.testnet",
      "reason": "ARUNA_MAX_PER_TX_EXCEEDED",
      "class": "local_upgradeable",
      "block": 277068996
    }
  },
  {
    "seq": 3,
    "block": 277069002,
    "timestamp_ms": 1794314625718,
    "tx_hash": "HF3Lnoodi81yF39cm94hQFZF6Ly2w3YFU5SW2Daqsnmv",
    "receipt_id": "6mGoBdM36hLWDdNpeKZ5AzdyXnP8jhfhaA9kcfmjTm66",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "execution_rejected",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "swap.arunafi.testnet",
      "reason": "ARUNA_SLIPPAGE_TOO_HIGH",
      "class": "local_upgradeable",
      "block": 277069002
    }
  },
  {
    "seq": 4,
    "block": 277069008,
    "timestamp_ms": 1794314629207,
    "tx_hash": "46oPP5KLp3yVoWX1dNqLYUnJsjto5H4tEnRduh1R1zgK",
    "receipt_id": "EEM8wtPvHobvBwFfWJ272Zxy7ZT1cEbU3wzR9VeskD6v",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "execution_rejected",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "attacker.testnet",
      "reason": "ARUNA_TARGET_NOT_ALLOWED",
      "class": null,
      "block": 277069008
    }
  },
  {
    "seq": 5,
    "block": 277069014,
    "timestamp_ms": 1794314632822,
    "tx_hash": "BxUgGjgxEG8JcojAZ1HC8upQDDw2ud4MkVUthx8euczL",
    "receipt_id": "5DPQS341eDe9RWJZwRQ6MByy8nFQiC1uQ9bm6urWpj97",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "execution_rejected",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "attacker-2.testnet",
      "reason": "ARUNA_TARGET_NOT_ALLOWED",
      "class": null,
      "block": 277069014
    }
  },
  {
    "seq": 6,
    "block": 277069014,
    "timestamp_ms": 1794314632822,
    "tx_hash": "BxUgGjgxEG8JcojAZ1HC8upQDDw2ud4MkVUthx8euczL",
    "receipt_id": "5DPQS341eDe9RWJZwRQ6MByy8nFQiC1uQ9bm6urWpj97",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "agent_auto_disabled",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "weighted_refusals": 28,
      "window_blocks": 1200
    }
  },
  {
    "seq": 7,
    "block": 277069020,
    "timestamp_ms": 1794314636451,
    "tx_hash": "CEZkfcTGSNSk2duqChy5Wc3SgyTFBAS7EJaTwapgBBLa",
    "receipt_id": "8vBZhWFVGm1G1D3pREsLw8rYSgpFWGD8aTFfzgi99UnC",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "execution_rejected",
    "data": {
      "agent": "ed25519:3r6KHvcr3pdRjRLmSnbBtKNYRaMab6rKissMuqTpshdi",
      "target": "swap.arunafi.testnet",
      "reason": "ARUNA_AGENT_AUTO_DISABLED",
      "class": "local_upgradeable",
      "block": 277069020
    }
  },
  {
    "seq": 8,
    "block": 277069040,
    "timestamp_ms": 1794314648700,
    "tx_hash": "At17sV6yJpARbtH9w4rPkT5w3qpATRxcddfeqZ1ALLrZ",
    "receipt_id": "Eg5RVhwq3Ckwa7464do6ZkDfKLG1s6TxZPP7MKu3QrcP",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "class_refreshed",
    "data": {
      "target": "swap.arunafi.testnet",
      "cached": {
        "class": "local_upgradeable",
        "frozen": false,
        "classified_at_block": 277068570,
        "fetched_at_block": 277069040
      }
    }
  },
  {
    "seq": 9,
    "block": 277069046,
    "timestamp_ms": 1794314652271,
    "tx_hash": "BqTxFWwXCSmFqkKeQawS8gm8YhpGu9Hwv9qqqJaXuHnJ",
    "receipt_id": "BgHGUbQ1Z1FsRBqZu8fcEFSTXYnttovji9k2mKye7Zyk",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "execution_allowed",
    "data": {
      "agent": "ed25519:7THAYJHPStMpR3xZjiKoHDdBu6ChQWfG6w93r9sUxHFi",
      "adapter": "swap",
      "target": "swap.arunafi.testnet",
      "amount": "100000000000000000000000",
      "class": "local_upgradeable"
    }
  },
  {
    "seq": 10,
    "block": 277069048,
    "timestamp_ms": 1794314653605,
    "tx_hash": "BqTxFWwXCSmFqkKeQawS8gm8YhpGu9Hwv9qqqJaXuHnJ",
    "receipt_id": "65JqwxhNbovjRf3cJvt7XFYaBbNLmi95w1KudJMsZfrX",
    "contract": "demo2.factory.arunafi.testnet",
    "event": "exposure_recorded",
    "data": {
      "agent": "ed25519:7THAYJHPStMpR3xZjiKoHDdBu6ChQWfG6w93r9sUxHFi",
      "target": "swap.arunafi.testnet",
      "amount": "100000000000000000000000",
      "class": "local_upgradeable",
      "total": "200000000000000000000000"
    }
  }
];

function page<T extends { seq: number }>(items: T[], after?: number, limit = 100): Page<T> {
  const rest = items.filter((i) => after === undefined || i.seq > after);
  const slice = rest.slice(0, limit);
  return { last_indexed_block: FIXTURE_LAST_INDEXED_BLOCK, items: slice, next_after: rest.length > slice.length ? slice[slice.length - 1].seq : null };
}

/** Answers like the live indexer, from the recorded data above. */
export const fixtureIndexerClient: IndexerClient = {
  async health() {
    return { last_indexed_block: FIXTURE_LAST_INDEXED_BLOCK, head_block: FIXTURE_LAST_INDEXED_BLOCK, lag_blocks: 0, unparsed_events: 0, healthy: true };
  },
  async vaults(q = {}) {
    const items = VAULTS.filter((v) => (!q.owner || v.owner === q.owner) && (!q.operator || v.operator === q.operator) && (!q.code_hash || v.code_hash === q.code_hash));
    return { last_indexed_block: FIXTURE_LAST_INDEXED_BLOCK, items, next_after: null };
  },
  async activity(vault, q = {}) {
    return page(ACTIVITY.filter((a) => a.vault === vault && (!q.agent || a.agent === q.agent) && (!q.kind || a.kind === q.kind)), q.after, q.limit);
  },
  async exposure(vault, q = {}) {
    return page(EXPOSURE.filter((e) => e.vault === vault && (!q.agent || e.agent === q.agent) && (!q.target || e.target === q.target) && (!q.token || e.token === q.token)), q.after, q.limit);
  },
  async events(q = {}) {
    const names = q.event ? q.event.split(",") : null;
    return page(EVENTS.filter((e) => (!q.contract || e.contract === q.contract) && (!names || names.includes(e.event)) && (!q.vault || e.contract === q.vault) && (!q.target || e.data.target === q.target)), q.after, q.limit);
  },
};
