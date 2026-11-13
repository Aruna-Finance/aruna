# @aruna/indexer

Every `aruna` NEP-297 event on testnet, read from public RPC endpoints into a Postgres database and served
over a read-only HTTP API. The indexer holds no keys and sends no transactions.

Plans: `docs/plans/2026-11-11-1645-feat-live-console-indexer-migration-sim-plan.md` (U1 read contract,
U2 ingest, U3 server) and `docs/plans/2026-11-13-0335-feat-indexer-postgres-supabase-plan.md` (the database).
Every route answers with the types in `src/api.ts`.

## How it reads the chain

- **Source.** Block by block, starting at block 277103284, where `registry2.arunafi.testnet`, the first of the v2 contracts, was created, and
  following only the v2 contracts (`factory2`, `registry2`, `pool2`; the v1 contracts are no longer indexed),
  over JSON-RPC from three endpoints, chosen per height (`src/ingest/routed.ts`):
  - **dRPC** (`live_rpc` in `config/testnet.json`), free with no key. It keeps only about the last two days
    of blocks (191,000 on 12 November 2026, from its `status` field `earliest_block_height`), and reads
    those and the head.
  - **neardata** (`FASTNEAR_API_KEY`, optional), the first-choice archive: `testnet.neardata.xyz` keeps every block
    and is read with a FastNear key, sent only as a Bearer header and never logged. Like any archive it reads only
    the heights below dRPC's earliest block plus 2,000, and once a height above that is read it is never called again.
  - **QuickNode** (`QUICKNODE_RPC_URL`, optional), the archive without a FastNear key, and the backup that reads
    what neardata fails to serve with one.
  - **NEAR's archival RPC** (`fallback_rpc`), free and slow, about 19 calls a minute. It reads older blocks
    when no archive is set, and any read the others failed; the failing endpoint is skipped for 5 minutes, then
    tried again. When an endpoint fails after it read a block, the block is read again, whole, from the next one.

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
  credits per block it reads, and only blocks older than dRPC's window go to it. neardata charges no credits: one
  request per block. `--concurrency` (default 8)
  is the window of heights read at once; each endpoint has its own limit inside it: neardata 8, QuickNode 3 (`QUICKNODE_CONCURRENCY`;
  a trial rate-limits at about 15 requests a second, and 8 hit HTTP 429 on 13 November 2026), dRPC 4, NEAR archival 1.
- **Which events count.** Only receipts that succeeded and were executed by a watched account. The
  watched set starts from the registries, factories and pools in `config/testnet.json`. A vault joins
  it when one of those factories emits `vault_created` for it. A look-alike event from any other
  account is ignored.
- **Unrecognised events.** An unknown event name, a malformed `EVENT_JSON` line, or a known event
  missing a field it needs is kept raw and counted in `/health` as `unparsed_events`. It is never
  dropped silently.
- **Initial operator.** A vault's initial operator comes from the factory's `create_vault`
  arguments, because no event names it.
- **Storage.** A Postgres database (`DATABASE_URL`, in production a Supabase project) holds the raw records and
  the tables derived from them. A window of consecutive blocks (`--concurrency` of them) is one transaction
  that first moves the cursor, and only if it is still where this process left it. A restart or a redeploy
  resumes from the cursor without duplicating anything; so does a second instance that runs for a minute
  during a deploy: it loses the commit, reloads the cursor and the vaults the other found, and goes on.
  The schema is created on the first start. Nothing is written to disk.

## Run it

Requires Node 22.13 or later and a Postgres database. For Supabase use the **Session pooler** URI (Connect,
then Session pooler, port 5432), not the Direct connection (IPv6) or the Transaction pooler (serverless clients).

```bash
pnpm --filter @aruna/indexer build
cp packages/indexer/.env.example packages/indexer/.env   # set DATABASE_URL; QUICKNODE_RPC_URL is optional
node --env-file=packages/indexer/.env packages/indexer/dist/cli.js serve --port 8080
curl -s localhost:8080/health
```

For a local database, `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres` with a running Postgres works.
With no other environment the indexer reads from dRPC and NEAR's archival RPC. `QUICKNODE_RPC_URL`, when set,
is the full "HTTP Provider" URL from the QuickNode dashboard, `https://<name>.<network>.quiknode.pro/<token>/`,
not only the token. The CLI does not read `.env` by itself, so pass it with `--env-file`. Expected: JSON
with `last_indexed_block` rising toward `head_block`, `source` naming the endpoint serving blocks, and
`mode` `catching_up` or `following`. `"healthy"` becomes `true` once
the lag is 60 blocks or less, and only while the indexer has read the chain's head in the last two
minutes (`head_seen_ms_ago`). An indexer that stopped reading is never reported as caught up. While the
database is unreachable `/health` still answers, with `"healthy":false` and `"last_indexed_block":0`, and the
other routes answer 503.

As a container. The build context is this folder, and nothing outside it is read:

```bash
docker build -t aruna-indexer packages/indexer
docker run -d --restart unless-stopped -p 8080:8080 --env-file packages/indexer/.env aruna-indexer
```

The image's health check is liveness only: it passes while the API answers. `/health` answers 200 even while `"healthy"` is `false`, so a restart policy never fires during the first backfill. To catch a stalled indexer, monitor the response text `"healthy":true`.

To run it on Railway, follow [`docs/DEPLOY-INDEXER-RAILWAY.md`](../../docs/DEPLOY-INDEXER-RAILWAY.md).

## Rebuild from nothing

```bash
QUICKNODE_RPC_URL=... node --env-file=packages/indexer/.env packages/indexer/dist/cli.js rebuild   # without it, older blocks read slowly
node --env-file=packages/indexer/.env packages/indexer/dist/cli.js export --out a.json
```

`rebuild` empties every table in the database and reads every block again from the start block. That is about
310,000 blocks as of 13 November 2026, so it takes hours. Two databases built from the same blocks export
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

| `GET /v1/coverages` | `Page<CoverageItem>`: each coverage with its terms, what claims paid out of it, and a `status` (`waiting`, `active`, `expired`, `released`) | `pool`, `vault`, `owner`, `agent`, `target`, `token`, `status` |
| `GET /v1/claims` | `Page<ClaimItem>`: every claim attempt, paid or refused with the pool's reason; a paid one carries every term of `min(exposure x ratio, remaining limit)` | `pool`, `vault`, `coverage`, `outcome` (`paid`, `rejected`) |
| `GET /v1/reports` | `Page<ReportItem>`: signed drift reports with their state (`pending`, `disputed`, `verified`, `rejected`), the report they dispute, and the end of the challenge window | `registry`, `target`, `attestor`, `state` |
| `GET /v1/freezes` | `Page<FreezeItem>`: `frozen` (a report was accepted), `pushed` (sent to a batch of vaults), `lifted`; the last item for a target says whether it is frozen (`frozen_after`) | `registry`, `target` |
| `GET /v1/heartbeats` | `Page<HeartbeatItem>` | `registry`, `attestor`, `target` (the attestor assigned to it now) |
| `GET /v1/attestors` | `Page<AttestorItem>`: bond, last heartbeat, `alive`, assigned targets, reports filed, bond slashed | `registry`, `attestor` |
| `GET /v1/classes` | `Page<ClassItem>`: the registry's class records for a target, oldest first, each with the class before it | `registry`, `target` |

Every list route also takes `after` and `limit`.

The last seven routes serve state derived from the contracts' events. A few fields depend on the
chain's clock: a coverage's `status`, a `pending` report that becomes `verified` when its challenge
window passes (as the registry reads it), an attestor being `alive`. They are computed against
`last_indexed_block`, which every page reports, so they are as of that block and never ahead of it.
`CHALLENGE_WINDOW_BLOCKS` and `HEARTBEAT_STALE_BLOCKS` in `src/api.ts` are copies of
`contracts/common/src/params.rs`; a test fails if they differ. An unknown filter value (`status=bogus`)
is a 400 that lists the allowed values; an unknown account is an empty page.

**An existing store is migrated on its next start.** The derived tables are a function of the raw
table, so when a store made by an older version opens, every derived table is rebuilt from the raw
events it already holds, in one transaction, before the first request is served. No block is read
again. The time is that of replaying the stored events: 100,000 of them took 6.8 seconds on a laptop
(measured 12 November 2026, a synthetic store of heartbeats and claims; the hosted store's size has not
been checked). `rebuild` is only for reading the chain again.

An `ActivityItem` keeps the event's own payload in `data`, beside the fields the console reads
directly (`agent`, `target`, `amount`, `token`, `reason`, `class`). Amounts are decimal strings in the
token's smallest unit. `token` is `near` or the fungible token's contract account id.

## Client

```ts
import { createIndexerClient, IndexerUnavailableError } from "@aruna/indexer/client";

const indexer = createIndexerClient({ baseUrl: "https://<indexer host>" });
const page = await indexer.activity("demo2.factory.arunafi.testnet", { kind: "refused" });
const coverages = await indexer.coverages({ vault: "demo4.factory2.arunafi.testnet" });
const target = await indexer.reports({ target: "drift-target.arunafi.testnet", state: "verified" });
```

`IndexerClient` has the first routes and `CoverageDriftClient` the seven above; `createIndexerClient`
returns both. They are separate so that a test double or the console's recorded fixture that implements
only the first keeps compiling.

The client needs only `fetch`, so it runs in the browser. An unreachable indexer, a non-200 answer,
or a body that is not a valid page all throw `IndexerUnavailableError`. Its `reason` is `network`,
`http` or `malformed`. An empty history is a page with no items, never an error, so a screen can tell
"history unavailable" apart from "nothing happened".

Until the live indexer is up, `apps/web/src/console/data/indexer-fixture.ts` answers with the same
types (the first routes only). Its data is the real events of the recorded `demo2` runs in `examples/README.md`.
