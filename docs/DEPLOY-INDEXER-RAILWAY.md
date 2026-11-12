# Deploying the indexer on Railway

One service, one public domain, one Supabase Postgres database. The service builds `packages/indexer/Dockerfile`, keeps
all its state in the database, and serves the read API. Nothing is written to the container's disk, so a redeploy, a
restart or a recreated service keeps the indexed history. Testnet only.

Everything under "Steps" is dashboard configuration except `packages/indexer/railway.json`, which sets the
builder, the healthcheck and the restart policy.

## Before you start

- A Railway project, and the Railway GitHub app granted access to `Aruna-Finance/aruna` (a private repository).
  Railway's docs say autodeploy needs a project member with a connected GitHub account and contributor access.
- **A Supabase project, in the same region as the Railway service.** Each block commits with a network round trip
  to the database, so a distant region slows the backfill. Then copy the **Session pooler** connection string:
  in the project, Connect, then Session pooler (port 5432). It looks like
  `postgresql://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres`. It carries the
  database password, so it is a secret: paste it into Railway's variables, never into the repo or a chat.
  - Not the Direct connection: Supabase serves it over IPv6 unless the project has the IPv4 add-on, and Railway
    may not reach it.
  - Not the Transaction pooler (port 6543): it is meant for short-lived serverless clients, and the indexer is one
    long-lived process.
- Optional: a QuickNode testnet endpoint URL, the full "HTTP Provider" URL: `https://<name>.<network>.quiknode.pro/<token>/`.
  It carries the token, so it is a secret. The indexer starts at block 277103406, about 110,000 blocks before the
  lower edge of what dRPC keeps, and that part is read from QuickNode when the URL is set and from NEAR's archival
  RPC otherwise, which takes days (see "The credit check").

## Steps

1. **New project, deploy from GitHub.** Pick `Aruna-Finance/aruna`, branch `main`.
2. **Root Directory.** Service Settings, Source: `/packages/indexer`. The Dockerfile reads nothing outside that
   folder, so this is all the build needs. This must be set: a service left at the repository root builds with the
   whole repository as its context, and the `COPY` lines find nothing. The Dockerfile path is `Dockerfile`, which
   `railway.json` sets and which is also Railway's default for the root of a source directory.
3. **Config file.** Railway's docs say the config file does not follow the Root Directory and takes an absolute
   path. Set it to `/packages/indexer/railway.json`.
4. **Watch Paths.** Set `/packages/indexer/**` (the form Railway's monorepo docs use). A push that changes no
   file under it does not deploy.
5. **Variables** (service Variables tab). These are all of them:

   | Variable | Value | Required |
   |---|---|---|
   | `DATABASE_URL` | the Supabase Session pooler URI | yes |
   | `QUICKNODE_RPC_URL` | the full endpoint URL | no: archive for blocks older than dRPC keeps |
   | `QUICKNODE_CONCURRENCY` | a number, default 3 | no: blocks read at once from QuickNode; lower it to 2 if the log shows `QuickNode failed (... HTTP 429)` |
   | `PORT` | `8080` | no: the port the API listens on. Set it so the domain's target port is unambiguous |

   The indexer needs no key to read the chain: dRPC and NEAR's archival RPC are keyless.
6. **Networking.** Generate a public domain, target port `8080`. CORS is open, so the console can call it from
   another origin.
7. **Deploy.**

### Moving an existing service off the volume

If the service already runs with a volume and the older variables: merge the change to `main` first (Railway deploys
`main`), then in the service's Variables tab set `DATABASE_URL` and delete `RAILWAY_RUN_UID`, `FASTNEAR_API_KEY`,
`ARUNA_INDEXER_DB` and `ARUNA_BLOCK_SOURCE`, and remove the volume. The old SQLite file is not migrated: the new
database starts empty at block 277103406 and reads the v2 contracts only. The v1 contracts are no longer indexed.

## The credit check

Do this before you paste a QuickNode URL. QuickNode charges 50 credits per NEAR call, and the indexer spends
about one call per block it reads there. It reads there only the blocks between its cursor and dRPC's earliest
block plus 2,000. On an empty database the cursor is the block before the start block, 277103405:

```bash
EARLIEST=$(curl -s -X POST https://near-testnet.drpc.org -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}' | jq .result.sync_info.earliest_block_height)
CURSOR=277103405   # on a running service: curl -s https://<domain>/health | jq .last_indexed_block
echo $(( (EARLIEST + 2000 - CURSOR) * 55 ))   # credits needed, with 10% to spare
```

If that number is above the credits the key has left, do not spend the key: the run would stop partway, and
the rest of the gap would be read from NEAR's archival RPC at about 19 blocks a minute, slower than the chain.
The gap grows by about 3,600 blocks (180,000 credits) an hour, because dRPC's window moves with the chain, and
the number above is for the moment you run it. Start the backfill as soon as the service is deployed, then
measure the blocks per second it reaches and compute again how long the gap needs: a slower rate means a bigger gap
by the time QuickNode finishes. Check the QuickNode dashboard an hour into the run and compare the credits spent
with the blocks covered.

## What you should see

The run goes through three phases. `/health` names the endpoint serving blocks in `source`:

| Phase | Logs | `/health` |
|---|---|---|
| 1. QuickNode, up to dRPC's window (only with `QUICKNODE_RPC_URL`) | `block source now: QuickNode` | `"source":"QuickNode","mode":"catching_up"` |
| 2. dRPC, catching up inside its window | `block source now: dRPC` | `"source":"dRPC","mode":"catching_up"` |
| 3. following the head | `indexed through <block> of <head>` | `"source":"dRPC","mode":"following","healthy":true` |

A line `dRPC failed (...); using NEAR archival for 5 min` means an endpoint was benched; `source` then reads
`NEAR archival` until it recovers.

- Deploy logs: `serving on :8080, database <host>` (the host only, never the credentials), then
  `block source: QuickNode to dRPC's edge, then dRPC; NEAR archival as fallback` (or, without QuickNode,
  `block source: dRPC; NEAR archival for older blocks and as fallback`).
- `curl https://<domain>/health` answers HTTP 200 with JSON:
  `{"last_indexed_block":…,"head_block":…,"lag_blocks":…,"healthy":false,…}`.
  During a backfill `healthy` is `false` and `last_indexed_block` rises. `healthy` turns `true` once the lag is
  60 blocks or less and the head was read in the last two minutes.
- `curl https://<domain>/v1/vaults` lists every vault created by `factory2.arunafi.testnet` once the backfill has
  passed its creation, and `.../v1/vaults/<vault>/activity` lists a vault's events.

`/health` answers 200 even while `healthy` is `false`, and even while the database is down (then with
`"last_indexed_block":0`, `"head_block":null`). That is deliberate: Railway's healthcheck accepts any 2xx and fails
the deploy otherwise, and a deploy must not fail because the backfill is still running or Supabase is briefly away.
Other routes answer 503 until the database is open.

## Auto-deploy

- A push to `main` that touches `packages/indexer/**` builds and deploys. Anything else does not, once Watch Paths
  is set. Railway's docs note that an empty commit does not redeploy when watch paths are set; use
  "Deploy Latest Commit" in the command palette to force one.
- **Check it once.** Railway's docs do not spell out the glob rules, so confirm them: push a change to
  `docs/` only and see that nothing deploys, then change a file under `packages/indexer/` and see that it does.
- Leave "Wait for CI" off: the repository has no GitHub Actions workflow for it to wait on.
- **A redeploy keeps the data.** The cursor lives in the database, so the new container reads on from the block
  after it. For a minute or two the old and the new container both run: only one of them can commit a given block,
  the other notices and takes the stored cursor, so no block is lost or stored twice. They share the pooler's client
  limit while they overlap; each uses at most three connections.

## Watching it

Railway checks `/health` only while a deploy goes live, not afterwards. A stalled indexer, such as a revoked
QuickNode token or an unreachable database, still answers 200, with `"healthy":false`. So add an external uptime
monitor that matches the response text `"healthy":true` and alerts when it is missing. Expect an alert during the
first backfill.

## Backups and rebuilds

The history is in Supabase, so it survives anything that happens to Railway. Backups beyond what Supabase provides by
default are not set up. `aruna-indexer rebuild` empties every table in the database and reads everything again from
block 277103406 on purpose. Run it with `DATABASE_URL` set (for example `railway run`), and expect the same
backfill as on the first deploy.

## If something fails

| Symptom | Cause and fix |
|---|---|
| `DATABASE_URL is not set` | add the variable (the Session pooler URI) and redeploy |
| `ENETUNREACH`, or a host `db.<ref>.supabase.co` that does not resolve | that is the Direct connection (IPv6); use the Session pooler URI |
| `password authentication failed` | the password in the URI is wrong, or contains characters that must be percent-encoded |
| `Tenant or user not found` | the user must be `postgres.<project-ref>` on the pooler, as the Connect dialog shows it |
| `max clients reached` | the pooler's client limit; stop other clients, or two deploys overlapped and one has not exited yet |
| `/health` answers `"last_indexed_block":0,"healthy":false` for more than a minute | the database is unreachable; check the Supabase project is not paused and the URI is right |
| `QUICKNODE_RPC_URL is not a URL` | the value is only the token; paste the full HTTP Provider URL |
| build cannot find `package.json` or `src` | Root Directory is not `/packages/indexer`, so the build runs from the repository root |
| deploy fails its healthcheck | the app is not on the port Railway expects; set `PORT=8080` |
| `last_indexed_block` barely moves, `source` is `NEAR archival` | the endpoint before it is failing. If it is QuickNode, its credits have likely run out: the index stays correct but reads about 19 blocks a minute, slower than the chain, so it will not catch up alone. Not built yet: a sparse backfill that reads only the blocks with Aruna transactions (see the plan of 12 November 2026) |
| `last_indexed_block` barely moves, `source` is `dRPC` | dRPC is rate-limiting; keep `--concurrency` at its default of 8 |

## Not confirmed in Railway's documentation

I could not find these stated, and the setup above is built so that none of them can break it:

- The Docker build context. The Dockerfile reads only its own folder, so any answer works.
- How Watch Paths treat leading slashes and globs. Check it as described under "Auto-deploy".
- Where the config-file path field sits in the dashboard. The docs only say the path is absolute from the repo root.
- Whether Railway injects `PORT` for a Dockerfile service. Set it yourself.
