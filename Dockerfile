# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
WORKDIR /workspace
RUN npm install --global pnpm@11.29.0 \
    && mkdir -p /pnpm/store \
    && chown -R node:node /pnpm /workspace

FROM base AS dependencies
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --chown=node:node apps/web/package.json apps/web/package.json
COPY --chown=node:node packages/eslint-config/package.json packages/eslint-config/package.json
COPY --chown=node:node packages/typescript-config/package.json packages/typescript-config/package.json
COPY --chown=node:node packages/ui/package.json packages/ui/package.json
USER node
RUN --mount=type=cache,id=mahoura-pnpm-store,target=/pnpm/store,uid=1000,gid=1000,sharing=locked \
    pnpm install --frozen-lockfile

FROM dependencies AS source
COPY --chown=node:node . .

# Independent containers; Compose Watch writes source into these images.
# No host bind mounts and no mounts on compiler output directories.
FROM source AS development
ENV NODE_ENV=development
EXPOSE 3000 3001


FROM source AS api-build
RUN pnpm --filter api build
RUN --mount=type=cache,id=mahoura-pnpm-store,target=/pnpm/store,uid=1000,gid=1000,sharing=locked \
    pnpm --filter api --prod deploy /workspace/api-runtime \
    && test -f /workspace/api-runtime/dist/main.js

FROM ${NODE_IMAGE} AS api-production
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0
WORKDIR /app
COPY --from=api-build --chown=node:node /workspace/api-runtime/ ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM source AS web-build
RUN pnpm --filter web build \
    && test -f apps/web/.next/standalone/apps/web/server.js

FROM ${NODE_IMAGE} AS web-production
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/standalone/ ./
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/static/ ./apps/web/.next/static/
COPY --from=web-build --chown=node:node /workspace/apps/web/public/ ./apps/web/public/
RUN mkdir -p /app/apps/web/.next/cache && chown -R node:node /app/apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
