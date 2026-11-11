# Deploying the indexer on Railway

One service, one volume, one public domain. The service builds `packages/indexer/Dockerfile`, keeps its SQLite
file on the volume, and serves the read API. Testnet only.

Everything under "Steps" is dashboard configuration except `packages/indexer/railway.json`, which sets the
builder, the healthcheck and the restart policy.

## Before you start

- A Railway project, and the Railway GitHub app granted access to `Aruna-Finance/aruna` (a private repository).
  Railway's docs say autodeploy needs a project member with a connected GitHub account and contributor access.
- The QuickNode testnet endpoint URL, the full "HTTP Provider" URL: `https://<name>.<network>.quiknode.pro/<token>/`.
  It carries the token, so it is a secret. Paste it into Railway's variables, never into the repo.

## Steps

1. **New project, deploy from GitHub.** Pick `Aruna-Finance/aruna`, branch `main`.
2. **Root Directory.** Service Settings, Source: `/packages/indexer`. The Dockerfile reads nothing outside that
   folder, so this is all the build needs.
3. **Config file.** Railway's docs say the config file does not follow the Root Directory and takes an absolute
   path. Set it to `/packages/indexer/railway.json`.
4. **Watch Paths.** Set `/packages/indexer/**` (the form Railway's monorepo docs use). A push that changes no
   file under it does not deploy.
5. **Variables** (service Variables tab):

   | Variable | Value | Why |
   |---|---|---|
   | `QUICKNODE_RPC_URL` | the full endpoint URL | the block source |
   | `RAILWAY_RUN_UID` | `0` | a volume is mounted root-owned and the image runs as `node`; Railway's documented fix |
   | `PORT` | `8080` | the port the API listens on. Set it so the domain's target port is unambiguous |

   `ARUNA_INDEXER_DB` is already `/data/aruna-indexer.sqlite` in the image, so the volume must mount at `/data`.
6. **Volume.** Add a volume to the service with mount path `/data`. A service can have one volume, and Railway's
   docs say replicas cannot be used with volumes, so this is a single instance by design.
7. **Networking.** Generate a public domain, target port `8080`. CORS is open, so the console can call it from
   another origin.
8. **Deploy.**

## What you should see

- Deploy logs: `block source: RPC endpoint (QUICKNODE_RPC_URL)`, then `serving on :8080`, then
  `indexed through <block> of <head>` lines.
- `curl https://<domain>/health` answers HTTP 200 with JSON:
  `{"last_indexed_block":…,"head_block":…,"lag_blocks":…,"healthy":false,…}`.
  During the first backfill `healthy` is `false` and `last_indexed_block` rises. That backfill is about 270,000
  blocks, roughly six hours at the default 8 blocks at a time (12.5 blocks/s measured on 11 November 2026).
  `healthy` turns `true` once the lag is 60 blocks or less and the head was read in the last two minutes.
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
| deploy fails its healthcheck | the app is not on the port Railway expects; set `PORT=8080` |
| `last_indexed_block` barely moves | the endpoint is rate-limiting; check QuickNode's dashboard, and keep `--concurrency` at its default of 8 unless you measured better |
| a rebuild starts from block 276952600 again | the volume is not mounted at `/data`, so the store is in the container's own filesystem |

## Not confirmed in Railway's documentation

I could not find these stated, and the setup above is built so that none of them can break it:

- The Docker build context. The Dockerfile reads only its own folder, so any answer works.
- How Watch Paths treat leading slashes and globs. Check it as described under "Auto-deploy".
- Where the config-file path field sits in the dashboard. The docs only say the path is absolute from the repo root.
- Whether Railway injects `PORT` for a Dockerfile service. Set it yourself.
