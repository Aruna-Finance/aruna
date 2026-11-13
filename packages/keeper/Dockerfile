# The Aruna freeze keeper as a long-running service. No HTTP port and no state: the chain is its only memory, so a
# restart loses nothing.
#
# The build context is the REPOSITORY ROOT, because the keeper depends on workspace packages. Railway: Root Directory
# `/`, config file `/packages/keeper/railway.json`. Locally:
#   docker build -f packages/keeper/Dockerfile -t aruna-keeper .
FROM node:24-slim AS build
ENV CI=true
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter "@aruna/keeper..."
RUN pnpm --filter "@aruna/keeper..." build
RUN pnpm --filter @aruna/keeper deploy --prod /out

FROM node:24-slim
WORKDIR /app
COPY --from=build /out ./
ENV NODE_ENV=production
USER node
# Flags come from the environment: ARUNA_KEEPER_ACCOUNT, ARUNA_KEEPER_REGISTRY, ARUNA_KEEPER_TARGETS, ARUNA_INDEXER_URL
# and ARUNA_KEEPER_KEY (`node dist/index.js --help` lists them).
CMD ["node", "dist/index.js", "run"]
