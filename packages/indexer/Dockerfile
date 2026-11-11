# The Aruna indexer: read API plus ingest, one process, one SQLite file on a volume (plan U3, KTD5).
# Build from the repository root:  docker build -f packages/indexer/Dockerfile -t aruna-indexer .
# Run:  docker run -d --restart unless-stopped -p 8080:8080 -v aruna-indexer:/data -e FASTNEAR_API_KEY=... aruna-indexer
FROM node:24-slim AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/indexer/package.json packages/indexer/tsconfig.json packages/indexer/tsconfig.build.json packages/indexer/
COPY packages/indexer/src packages/indexer/src
WORKDIR /repo/packages/indexer
RUN npm install --no-save --no-package-lock typescript@5.9.3 @types/node@22.20.5 && npx tsc -p tsconfig.build.json

FROM node:24-slim
WORKDIR /app
COPY --from=build /repo/packages/indexer/dist ./dist
COPY packages/indexer/config ./config
COPY packages/indexer/package.json ./
ENV NODE_ENV=production ARUNA_INDEXER_DB=/data/aruna-indexer.sqlite PORT=8080
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>r.json()).then(h=>process.exit(h.healthy?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/cli.js", "serve"]
