# The Aruna attestor as a long-running service: it watches the targets the registry assigns to it, sends heartbeats and
# files signed drift reports. No HTTP port: the service is healthy while `heartbeat_fresh` reads true on the registry.
#
# The build context is the REPOSITORY ROOT, because the attestor depends on workspace packages. Railway: Root Directory
# `/`, config file `/packages/attestor/railway.json`. Locally:
#   docker build -f packages/attestor/Dockerfile -t aruna-attestor .
#
# State (the last observation of each target) lives in /data. Mount a volume there: without it a restart forgets what
# it saw, and a change made while it was down is never reported. Railway mounts volumes as root, so set
# RAILWAY_RUN_UID=0 on the service (docs/DEPLOY-ATTESTOR-KEEPER-RAILWAY.md). There is no VOLUME instruction, which
# Railway rejects.
FROM node:24-slim AS build
ENV CI=true
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter "@aruna/attestor..."
RUN pnpm --filter "@aruna/attestor..." build
RUN pnpm --filter @aruna/attestor deploy --prod /out

FROM node:24-slim
WORKDIR /app
COPY --from=build /out ./
ENV NODE_ENV=production ARUNA_ATTESTOR_STATE_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
# Flags come from the environment: ARUNA_ATTESTOR_ACCOUNT, ARUNA_ATTESTOR_REGISTRY, ARUNA_ATTESTOR_TARGETS,
# ARUNA_INDEXER_URL and the two key variables (`node dist/index.js --help` lists them).
CMD ["node", "dist/index.js", "watch"]
