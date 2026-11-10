# syntax=docker/dockerfile:1

ARG NODE_VERSION=26.13.0

FROM node:${NODE_VERSION}-trixie-slim AS base
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

FROM base AS build
ARG PNPM_VERSION=12.18.0
RUN npm install --global --allow-scripts=pnpm "pnpm@${PNPM_VERSION}" && npm cache clean --force
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@smsvio/web --filter=@smsvio/api --filter=@smsvio/worker
RUN pnpm --filter @smsvio/api deploy --prod /out/api \
 && pnpm --filter @smsvio/worker deploy --prod /out/worker \
 && pnpm --filter @smsvio/migrate deploy --prod /out/migrate \
 && cp -r packages/db/prisma packages/db/prisma.config.ts /out/migrate/ \
 && mkdir -p /out/web \
 && cp -a apps/web/.next/standalone/. /out/web/ \
 && mkdir -p /out/web/apps/web/.next \
 && cp -a apps/web/.next/static /out/web/apps/web/.next/static \
 && if [ -d apps/web/public ]; then cp -a apps/web/public /out/web/apps/web/public; fi

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
ARG APP_RELEASE=dev
ENV APP_RELEASE=${APP_RELEASE}
LABEL org.opencontainers.image.source="https://github.com/Murvanidz3/smsvio"

FROM runtime AS api
COPY --from=build /out/api ./
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]

FROM runtime AS worker
COPY --from=build /out/worker ./
USER node
CMD ["node", "--enable-source-maps", "--import", "./dist/instrument.js", "dist/main.js"]

FROM runtime AS migrate
COPY --from=build /out/migrate ./
ENV HOME=/tmp
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM runtime AS web
COPY --from=build /out/web ./
ENV HOSTNAME=0.0.0.0 \
    PORT=3000
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
