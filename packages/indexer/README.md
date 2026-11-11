# @aruna/indexer

Every `aruna` NEP-297 event on testnet, read from the public block archive, served over a read-only
HTTP API. The indexer holds no keys and sends no transactions.

Plan: `docs/plans/2026-11-11-1645-feat-live-console-indexer-migration-sim-plan.md` (U1 read contract,
U2 ingest, U3 server). Every route answers with the types in `src/api.ts`.

## How it reads the chain

- **Source.** Block by block, starting at block 276952600, just before `registry.arunafi.testnet` was
  created. Set `QUICKNODE_RPC_URL` to a QuickNode testnet endpoint (archive, no pruning), and the indexer
  reads over JSON-RPC:
  1. `EXPERIMENTAL_changes_in_block` lists every account a block touched. A block that touches no
     watched account costs this one call.
  2. For the watched accounts it asks for the receipts that changed them (`EXPERIMENTAL_changes`), the
     transaction of each (`EXPERIMENTAL_receipt_to_tx`) and its outcomes with their logs
     (`EXPERIMENTAL_tx_status`).

  An event is seen when the receipt that logged it changed the account's state. Every Aruna contract
  emits from a method that writes its state, and the tests replay recorded testnet blocks to check that
  the records equal what a full block read gives.
- **The endpoint URL is a secret.** A QuickNode URL carries its token in the path. It is read from the
  environment, never logged, and removed from every error message. The indexer refuses an endpoint whose
  `status` reports a chain other than testnet.
- **Cost.** At least one call per block, so a full backfill is about 260,000 calls as of 11 November
  2026, plus a handful for each block that touches an Aruna account. The per-method credit cost is not in
  the QuickNode documentation I read, so check your plan's credits and request rate. The default
  `--concurrency` for an RPC endpoint is 8, where throughput peaked in a measurement on 11 November 2026
  (12.5 blocks/s on blocks with no Aruna activity, about 6 hours for the whole backfill). Higher values were
  slower, 10.6 at 16 and 5.5 at 48, because the endpoint rate-limits and the retries cost more than the
  parallelism gains. Another plan may peak elsewhere, so pass `--concurrency` to change it.
- **Without a QuickNode URL** the indexer falls back to `testnet.neardata.xyz`. Without a key, that
  serves 30 blocks a minute (measured 11 November 2026), below testnet's block rate. Set
  `FASTNEAR_API_KEY` to a FastNear key to speed it up; it is sent as `Authorization: Bearer` and never
  logged.
- **Which events count.** Only receipts that succeeded and were executed by a watched account. The
  watched set starts from the registries, factories and pools in `config/testnet.json`. A vault joins
  it when one of those factories emits `vault_created` for it. A look-alike event from any other
  account is ignored.
- **Unrecognised events.** An unknown event name, a malformed `EVENT_JSON` line, or a known event
  missing a field it needs is kept raw and counted in `/health` as `unparsed_events`. It is never
  dropped silently.
- **Initial operator.** A vault's initial operator comes from the factory's `create_vault`
  arguments, because no event names it.
- **Storage.** One SQLite file holds the raw records and the tables derived from them, and each block
  is committed with the cursor. A restart resumes from the cursor without duplicating anything.

## Run it

Requires Node 22.13 or later, for `node:sqlite`.

```bash
pnpm --filter @aruna/indexer build
cp packages/indexer/.env.example packages/indexer/.env   # then fill in QUICKNODE_RPC_URL
node --env-file=packages/indexer/.env packages/indexer/dist/cli.js serve --db aruna-indexer.sqlite --port 8080
curl -s localhost:8080/health
```

`QUICKNODE_RPC_URL` is the full "HTTP Provider" URL from the QuickNode dashboard,
`https://<name>.<network>.quiknode.pro/<token>/`, not only the token. The CLI does not read `.env` by
itself, so pass it with `--env-file`. Expected: JSON with `last_indexed_block` rising toward `head_block`. `"healthy"` becomes `true` once
the lag is 60 blocks or less, and only while the indexer has read the chain's head in the last two
minutes (`head_seen_ms_ago`). An indexer that stopped reading is never reported as caught up.

As a container, built from the repository root:

```bash
docker build -f packages/indexer/Dockerfile -t aruna-indexer .
docker run -d --restart unless-stopped -p 8080:8080 -v aruna-indexer:/data --env-file packages/indexer/.env aruna-indexer
```

The image's health check calls `/health`. It fails while the indexer is more than 60 blocks behind, which includes the first backfill, so do not let an orchestrator restart the container on an unhealthy status. And it fails when ingest has stopped reading the head.

## Rebuild from nothing

```bash
QUICKNODE_RPC_URL=... node packages/indexer/dist/cli.js rebuild --db a.sqlite
node packages/indexer/dist/cli.js export --db a.sqlite --out a.json
```

`rebuild` deletes the store and reads every block again from the start block. That is about 260,000
blocks as of 11 November 2026, so it takes hours. Two stores rebuilt from the same blocks export
byte-identical JSON.

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
