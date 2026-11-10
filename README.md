# SMSVIO

SMSVIO is a business SMS platform: one dashboard and one API for sending messages. This
repository holds the whole product — web app, API, background worker, database schema and the
infrastructure that runs it at [smsvio.com](https://smsvio.com).

The build follows the phases in [`docs/SPEC.md`](docs/SPEC.md). **Phase 0 (foundation)** is
complete: monorepo, tooling, health endpoints, placeholder landing page, sign-in shell, Docker,
CI/CD and production hosting.

## Repository layout

```
apps/
  web/        Next.js 16 app: landing page, sign-in, dashboard (from Phase 1)
  api/        NestJS + Fastify REST API (/api/*, /healthz, /readyz)
  worker/     NestJS background worker (queues from Phase 2)
  migrate/    Runtime dependencies of the one-shot migration container
packages/
  config/     Shared ESLint, Prettier and TypeScript presets
  shared/     Env validation, readiness checks and error helpers (zod)
  db/         Prisma schema, migrations and client factory
  server/     NestJS modules shared by api and worker: logging, Prisma, Redis, probes, Sentry
infra/
  caddy/      Caddy image and Caddyfiles (production and local)
  scripts/    bootstrap.sh, deploy.sh, rollback.sh, compose.sh
  docker-compose.prod.yml
docs/         SPEC.md, DEPLOY.md, DECISIONS.md
```

## Requirements

- Node.js **26.13.0** (see `.node-version`)
- pnpm **12.18.0**: `npm install --global pnpm@12.18.0`
- Docker with Compose v2, for the local stack

## Run the full stack in Docker

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:8080>. Caddy routes `/api/*`, `/healthz` and `/readyz` to the api and
everything else to the web app, exactly as in production. Migrations run automatically before
the api and worker start. Check readiness with `curl http://localhost:8080/readyz`.

## Develop locally

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis      # databases only
pnpm --filter @smsvio/db migrate:deploy  # apply migrations
pnpm dev                                 # web :3000, api :4000, worker (all with reload)
```

`.env` is read by Docker Compose, by the api and worker in development and by Prisma. Every
variable is documented in [`.env.example`](.env.example). The apps validate their environment at
startup and exit with a list of the invalid keys.

Create a migration after changing `packages/db/prisma/schema.prisma`:

```bash
pnpm --filter @smsvio/db migrate:dev --name <change-name>
```

## Quality checks

| Command                 | What it does                                                            |
| ----------------------- | ----------------------------------------------------------------------- |
| `pnpm lint`             | ESLint on every package (zero warnings) and Prettier check              |
| `pnpm typecheck`        | Strict TypeScript across the workspace                                  |
| `pnpm test`             | Unit tests with coverage thresholds                                     |
| `pnpm test:integration` | API tests against real Postgres and Redis (`DATABASE_URL`, `REDIS_URL`) |
| `pnpm test:e2e`         | Playwright: light and dark themes at desktop and mobile sizes           |
| `pnpm build`            | Production build of every package                                       |
| `pnpm format`           | Format the repository with Prettier                                     |

Install the Playwright browser once with `pnpm --filter @smsvio/web exec playwright install chromium`.
The end-to-end tests fail on any browser console error or warning.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of the above plus a
fresh-clone `docker compose up` smoke test on every pull request and push.

## Deployment

Every push to `main` that passes CI is built into images, pushed to GHCR and deployed to the VPS,
with an automatic rollback if the new release is not ready. Setup from a fresh server, manual
deploys, rollback, secret rotation, logs and monitoring are in [`docs/DEPLOY.md`](docs/DEPLOY.md).

| Endpoint                     | Meaning                                        |
| ---------------------------- | ---------------------------------------------- |
| `https://smsvio.com/healthz` | The api process is running                     |
| `https://smsvio.com/readyz`  | The api can reach Postgres and Redis (200/503) |

## Decisions

Technical and product decisions, with reasons, are recorded in
[`docs/DECISIONS.md`](docs/DECISIONS.md).
