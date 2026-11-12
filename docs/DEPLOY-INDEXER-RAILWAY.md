# Deploying the indexer on Railway

One service, one volume, one public domain. The service builds `packages/indexer/Dockerfile`, keeps its SQLite
file on the volume, and serves the read API. Testnet only.

Everything under "Steps" is dashboard configuration except `packages/indexer/railway.json`, which sets the
builder, the healthcheck and the restart policy.

## Before you start

- A Railway project, and the Railway GitHub app granted access to `Aruna-Finance/aruna` (a private repository).
  Railway's docs say autodeploy needs a project member with a connected GitHub account and contributor access.
- Optional: a QuickNode testnet endpoint URL, the full "HTTP Provider" URL: `https://<name>.<network>.quiknode.pro/<token>/`.
  It carries the token, so it is a secret. Paste it into Railway's variables, never into the repo. The indexer
  runs without it on dRPC and NEAR's archival RPC, which need no key; QuickNode only speeds up blocks older
  than dRPC keeps (see "The credit check").

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
5. **Variables** (service Variables tab):

   | Variable | Value | Why |
   |---|---|---|
   | `QUICKNODE_RPC_URL` | the full endpoint URL, or unset | optional archive for blocks older than dRPC keeps |
   | `QUICKNODE_CONCURRENCY` | a number, default 3 | blocks read at once from QuickNode; lower it to 2 if the log shows `QuickNode failed (... HTTP 429)` |
   | `RAILWAY_RUN_UID` | `0` | a volume is mounted root-owned and the image runs as `node`; Railway's documented fix |
   | `PORT` | `8080` | the port the API listens on. Set it so the domain's target port is unambiguous |

   `ARUNA_INDEXER_DB` is already `/data/aruna-indexer.sqlite` in the image, so the volume must mount at `/data`.
   A `FASTNEAR_API_KEY` left from an earlier setup is ignored (the logs say so); you may delete it.
6. **Volume.** Add a volume to the service with mount path `/data`. Do this in the dashboard: the Dockerfile has no
   `VOLUME` instruction, because Railway rejects one when it validates the file. A service can have one volume, and Railway's
   docs say replicas cannot be used with volumes, so this is a single instance by design.
7. **Networking.** Generate a public domain, target port `8080`. CORS is open, so the console can call it from
   another origin.
8. **Deploy.**

## The credit check

Do this before you paste a QuickNode URL. QuickNode charges 50 credits per NEAR call, and the indexer spends
about one call per block it reads there. It reads there only the blocks between its cursor and dRPC's earliest
block plus 2,000:

```bash
EARLIEST=$(curl -s -X POST https://near-testnet.drpc.org -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}' | jq .result.sync_info.earliest_block_height)
CURSOR=$(curl -s https://<domain>/health | jq .last_indexed_block)
echo $(( (EARLIEST + 2000 - CURSOR) * 55 ))   # credits needed, with 10% to spare
```

If that number is above the credits the key has left, do not spend the key: the run would stop partway, and
the rest of the gap would be read from NEAR's archival RPC at about 19 blocks a minute, slower than the chain.
The gap grows by about 3,600 blocks (180,000 credits) an hour, because dRPC's window moves with the chain.
Check the QuickNode dashboard an hour into the run and compare the credits spent with the blocks covered.

## What you should see

The run goes through three phases. `/health` names the endpoint serving blocks in `source`:

| Phase | Logs | `/health` |
|---|---|---|
| 1. QuickNode, up to dRPC's window (only with `QUICKNODE_RPC_URL`) | `block source now: QuickNode` | `"source":"QuickNode","mode":"catching_up"` |
| 2. dRPC, catching up inside its window | `block source now: dRPC` | `"source":"dRPC","mode":"catching_up"` |
| 3. following the head | `indexed through <block> of <head>` | `"source":"dRPC","mode":"following","healthy":true` |

A line `dRPC failed (...); using NEAR archival for 5 min` means an endpoint was benched; `source` then reads
`NEAR archival` until it recovers.

- Deploy logs: `block source: QuickNode to dRPC's edge, then dRPC; NEAR archival as fallback` (or, without
  QuickNode, `block source: dRPC; NEAR archival for older blocks and as fallback`), then `serving on :8080`.
- `curl https://<domain>/health` answers HTTP 200 with JSON:
  `{"last_indexed_block":…,"head_block":…,"lag_blocks":…,"healthy":false,…}`.
  During a backfill `healthy` is `false` and `last_indexed_block` rises. QuickNode reads about 12.5 blocks/s
  (11 November 2026). `healthy` turns `true` once the lag is 60 blocks or less and the head was read in the
  last two minutes.
- `curl https://<domain>/v1/vaults?operator=demo-company.arunafi.testnet` lists `demo2` after the backfill
  passes block 277068625, and `.../v1/vaults/<vault>/activity` lists its events.

`/health` answers 200 even while `healthy` is `false`. That is deliberate: Railway's healthcheck accepts any 2xx
and fails the deploy otherwise, and a deploy must not fail because the backfill is still running.

## Auto-deploy

- A push to `main` that touches `packages/indexer/**` builds and deploys. Anything else does not, once Watch Paths
  is set. Railway's docs note that an empty commit does not redeploy when watch paths are set; use
  "Deploy Latest Commit" in the command palette to force one.
- **Check it once.** Railway's docs do not spell out the glob rules, so confirm them: push a change to
  `docs/` only and see that nothing deploys, then change a file under `packages/indexer/` and see that it does.
- Leave "Wait for CI" off: the repository has no GitHub Actions workflow for it to wait on.
- **A redeploy is safe but not seamless.** The cursor lives on the volume, so ingest resumes where it stopped.
  Railway's docs say a service with a volume has a small downtime on redeploy, because two deployments cannot
  mount the volume at once. Avoid pushing to `packages/indexer/` while someone is recording a demo.

## Watching it

Railway checks `/health` only while a deploy goes live, not afterwards. A stalled indexer, such as a revoked
QuickNode token, still answers 200, with `"healthy":false`. So add an external uptime monitor that matches the
response text `"healthy":true` and alerts when it is missing. Expect an alert during the first backfill.

## Backups and rebuilds

Railway supports manual and automated volume backups; turn them on. Without one, losing the volume means a full
backfill again (about six hours). `aruna-indexer rebuild` does the same on purpose.

## If something fails

| Symptom | Cause and fix |
|---|---|
| `cannot write to /data` | `RAILWAY_RUN_UID=0` is not set |
| `QUICKNODE_RPC_URL is not a URL` | the value is only the token; paste the full HTTP Provider URL |
| build fails with "The Dockerfile failed validation" | the Dockerfile has a `VOLUME` instruction; it must not (a test guards this) |
| build cannot find `package.json` or `src` | Root Directory is not `/packages/indexer`, so the build runs from the repository root |
| deploy fails its healthcheck | the app is not on the port Railway expects; set `PORT=8080` |
| `last_indexed_block` barely moves, `source` is `NEAR archival` | the endpoint before it is failing. If it is QuickNode, its credits have likely run out: the index stays correct but reads about 19 blocks a minute, slower than the chain, so it will not catch up alone. Not built yet: a sparse backfill that reads only the blocks with Aruna transactions (see the plan of 12 November 2026) |
| `last_indexed_block` barely moves, `source` is `dRPC` | dRPC is rate-limiting; keep `--concurrency` at its default of 8 |
| a rebuild starts from block 276952600 again | the volume is not mounted at `/data`, so the store is in the container's own filesystem |

## Not confirmed in Railway's documentation

I could not find these stated, and the setup above is built so that none of them can break it:

- The Docker build context. The Dockerfile reads only its own folder, so any answer works.
- How Watch Paths treat leading slashes and globs. Check it as described under "Auto-deploy".
- Where the config-file path field sits in the dashboard. The docs only say the path is absolute from the repo root.
- Whether Railway injects `PORT` for a Dockerfile service. Set it yourself.
