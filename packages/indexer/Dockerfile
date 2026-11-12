# The Aruna indexer: read API plus ingest, one process, its state in a Postgres database named by DATABASE_URL (plan U4).
# Nothing is written to the container's disk, so a redeploy, a restart or a recreated service keeps the indexed history.
#
# The build context is this directory, and nothing outside it is read, so a host can build it with this folder as the
# root (Railway: Root Directory /packages/indexer, Dockerfile path "Dockerfile").
#   docker build -t aruna-indexer packages/indexer
#   docker run -d --restart unless-stopped -p 8080:8080 --env-file packages/indexer/.env aruna-indexer

FROM node:24-slim AS build
WORKDIR /app
COPY package.json tsconfig.build.json ./
RUN npm install --omit=dev --no-package-lock && npm install --no-save --no-package-lock typescript@5.9.3 @types/node@22.20.5
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-package-lock
COPY --from=build /app/dist ./dist
COPY config ./config
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
# Liveness only: the API answers. Whether ingest keeps up is the "healthy" field of /health, which is false while the
# first backfill runs and while the database is unreachable, so it must not decide whether the container is restarted.
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/cli.js", "serve"]
