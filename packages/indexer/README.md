# @aruna/indexer

Every `aruna` NEP-297 event on testnet, read from the public block archive, served over a read-only
HTTP API. The indexer holds no keys and sends no transactions.

This package ships the read contract and a typed client first (plan
`docs/plans/2026-11-11-1645-feat-live-console-indexer-migration-sim-plan.md`, U1). Ingest (U2) and the
server (U3) build against the same types in `src/api.ts`.

## Read contract

GET only, JSON, open CORS, no auth. Every response carries `last_indexed_block`. List routes return
a page:

```json
{ "last_indexed_block": 277069048, "items": [], "next_after": null }
```

Items are ordered by `seq`, the order the indexer read them from the chain. To read the next page,
pass `after=<next_after>`. `limit` defaults to 100, and the server clamps it to 500.

| Route | Returns | Filters |
|---|---|---|
| `GET /health` | `Health`: last indexed block, head block, lag, count of unparsed events | |
| `GET /v1/vaults` | `Page<VaultSummary>`: vault, factory, current owner and operator, code hash, creation block and tx | `owner`, `operator`, `code_hash` |
| `GET /v1/vaults/:vault/activity` | `Page<ActivityItem>`: allowed, refused (reason code and class), failed, exposure, auto-disabled, agent and policy changes, class refreshes, freezes, deposits, withdrawals, role and ceiling changes | `agent`, `kind` |
| `GET /v1/vaults/:vault/exposure` | `Page<ExposureRow>`: one row per `exposure_recorded`, with the target's class at the time it was recorded | `agent`, `target`, `token` |
| `GET /v1/events` | `Page<EventItem>`: any event from a watched contract. Covers coverage, claims, drift reports, freezes, heartbeats and class changes | `contract`, `event` (comma-separated), `vault`, `target`, `attestor`, `coverage` |

Every list route also takes `after` and `limit`.

An `ActivityItem` keeps the event's own payload in `data`, beside the fields the console reads
directly (`agent`, `target`, `amount`, `token`, `reason`, `class`). Amounts are decimal strings in the
token's smallest unit. `token` is `near` or the fungible token's contract account id.

## Client

```ts
import { createIndexerClient, IndexerUnavailableError } from "@aruna/indexer/client";

const indexer = createIndexerClient({ baseUrl: "https://<indexer host>" });
const page = await indexer.activity("demo2.factory.arunafi.testnet", { kind: "refused" });
```

The client needs only `fetch`, so it runs in the browser. An unreachable indexer, a non-200 answer,
or a body that is not a valid page all throw `IndexerUnavailableError`. Its `reason` is `network`,
`http` or `malformed`. An empty history is a page with no items, never an error, so a screen can tell
"history unavailable" apart from "nothing happened".

Until the live indexer is up, `apps/web/src/console/data/indexer-fixture.ts` answers with the same
types. Its data is the real events of the recorded `demo2` runs in `examples/README.md`.
