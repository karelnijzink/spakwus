# Copyright Nisse Group Ltd
# Spakwus @nissegroup/core — production image.
# Build context MUST be the repo root (this is a pnpm workspace):
#   docker build -f packages/core/Dockerfile -t spakwus-core .

# --- build stage ------------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable
ENV PNPM_HOME=/pnpm

# Install with the lockfile using only the manifests first (better layer caching).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/hub/package.json packages/hub/
RUN pnpm install --frozen-lockfile

# Build shared + core, then produce a self-contained prod deployment of core
# (workspace deps injected, dev deps dropped) at /prod/core.
COPY . .
RUN pnpm --filter @nissegroup/shared run build \
 && pnpm --filter @nissegroup/core run build \
 && pnpm --filter @nissegroup/core deploy --prod --legacy /prod/core

# --- runtime stage ----------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
# /prod/core is fully self-contained: dist/, drizzle/ (migrations run at startup),
# and a flat node_modules with @nissegroup/shared and prod deps.
COPY --from=build /prod/core /app
EXPOSE 3000

# The static fallback file is written to ./public by default; on Fly mount a
# volume at /app/public, or set SNAPSHOT_PUBLISH=http to push to a CDN.
CMD ["node", "dist/index.js"]
