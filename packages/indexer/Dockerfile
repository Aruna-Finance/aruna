# The Aruna indexer: read API plus ingest, one process, one SQLite file on a volume (plan U3, KTD5).
#
# The build context is this directory, and nothing outside it is read, so a host can build it with this folder as the
# root (Railway: Root Directory /packages/indexer, Dockerfile path "Dockerfile").
#   docker build -t aruna-indexer packages/indexer
#   docker run -d --restart unless-stopped -p 8080:8080 -v aruna-indexer:/data --env-file packages/indexer/.env aruna-indexer
#
# There is no VOLUME instruction: Railway rejects it when it validates the file. The database lives in /data, and the
# host mounts the volume there (docker run -v above; a Railway volume at /data).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json tsconfig.build.json ./
COPY src ./src
RUN npm install --no-save --no-package-lock typescript@5.9.3 @types/node@22.20.5 && npx tsc -p tsconfig.build.json

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY config ./config
COPY package.json ./
ENV NODE_ENV=production ARUNA_INDEXER_DB=/data/aruna-indexer.sqlite PORT=8080
RUN mkdir -p /data && chown node:node /data
EXPOSE 8080
USER node
# Liveness only: the API answers. Whether ingest keeps up is the "healthy" field of /health, which is false while the
# first backfill runs, so it must not decide whether the container is restarted.
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/cli.js", "serve"]
