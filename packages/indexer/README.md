# @aruna/indexer

Every `aruna` NEP-297 event on testnet, read from the public block archive, served over a read-only
HTTP API. The indexer holds no keys and sends no transactions.

Plan: `docs/plans/2026-11-11-1645-feat-live-console-indexer-migration-sim-plan.md` (U1 read contract,
U2 ingest, U3 server). Every route answers with the types in `src/api.ts`.

## How it reads the chain

- **Source.** Block by block, starting at block 276952600, just before `registry.arunafi.testnet` was
  created, over JSON-RPC from three endpoints, chosen per height (`src/ingest/routed.ts`):
  - **dRPC** (`live_rpc` in `config/testnet.json`), free with no key. It keeps only about the last two days
    of blocks (191,000 on 12 November 2026, from its `status` field `earliest_block_height`), and reads
    those and the head.
  - **QuickNode** (`QUICKNODE_RPC_URL`, optional), an archive. It reads only the heights below dRPC's
    earliest block plus 2,000, and once a height above that is read it is never called again.
  - **NEAR's archival RPC** (`fallback_rpc`), free and slow, about 19 calls a minute. It reads older blocks
    when no QuickNode URL is set, and any read another endpoint failed; the failing endpoint is skipped for
    5 minutes, then tried again.

  dRPC answers `UNKNOWN_BLOCK` both for a height the chain skipped and for one it no longer holds, so a
  height read there counts as skipped only when a later block's `prev_height` shows it. Each read:
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
- **Cost.** At least one call per block, plus a handful for each block that touches an Aruna account.
  QuickNode charges 50 credits per NEAR call (quicknode.com/api-credits/near), so it costs about 50
  credits per block it reads, and only blocks older than dRPC's window go to it. `--concurrency` (default 8)
  is the window of heights read at once; each endpoint has its own limit inside it: QuickNode 8 (its
  throughput peaked there on 11 November 2026, 12.5 blocks/s), dRPC 4, NEAR archival 1.
- **neardata.** `ARUNA_BLOCK_SOURCE=neardata` reads `testnet.neardata.xyz` instead, with
  `FASTNEAR_API_KEY` when set (sent as `Authorization: Bearer`, never logged). Without a key it serves 30
  blocks a minute, below testnet's block rate. A `FASTNEAR_API_KEY` alone no longer selects it.
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
cp packages/indexer/.env.example packages/indexer/.env   # QUICKNODE_RPC_URL is optional
node --env-file=packages/indexer/.env packages/indexer/dist/cli.js serve --db aruna-indexer.sqlite --port 8080
curl -s localhost:8080/health
```

With no environment the indexer reads from dRPC and NEAR's archival RPC. `QUICKNODE_RPC_URL`, when set,
is the full "HTTP Provider" URL from the QuickNode dashboard, `https://<name>.<network>.quiknode.pro/<token>/`,
not only the token. The CLI does not read `.env` by itself, so pass it with `--env-file`. Expected: JSON
with `last_indexed_block` rising toward `head_block`, `source` naming the endpoint serving blocks, and
`mode` `catching_up` or `following`. `"healthy"` becomes `true` once
the lag is 60 blocks or less, and only while the indexer has read the chain's head in the last two
minutes (`head_seen_ms_ago`). An indexer that stopped reading is never reported as caught up.

As a container. The build context is this folder, and nothing outside it is read. The image has no `VOLUME` instruction (Railway rejects one), so mount the volume at `/data` yourself:

```bash
docker build -t aruna-indexer packages/indexer
docker run -d --restart unless-stopped -p 8080:8080 -v aruna-indexer:/data --env-file packages/indexer/.env aruna-indexer
```

The image's health check is liveness only: it passes while the API answers. `/health` answers 200 even while `"healthy"` is `false`, so a restart policy never fires during the first backfill. To catch a stalled indexer, monitor the response text `"healthy":true`.

To run it on Railway, follow [`docs/DEPLOY-INDEXER-RAILWAY.md`](../../docs/DEPLOY-INDEXER-RAILWAY.md).

## Rebuild from nothing

```bash
QUICKNODE_RPC_URL=... node packages/indexer/dist/cli.js rebuild --db a.sqlite   # without it, older blocks read slowly
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
