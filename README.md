# SMSVIO

SMSVIO is a business SMS platform: one dashboard and one API for sending messages. This
repository holds the whole product — web app, API, background worker, database schema and the
infrastructure that runs it at [smsvio.com](https://smsvio.com).

The build follows the phases in [`docs/SPEC.md`](docs/SPEC.md). **Phase 3 part A (providers,
routes, rates, senders, and balances)** is in place. Operators set a markup on each provider,
see the resulting customer price, import manual rates, and credit a balance. Customers enable
countries and request a sender. The send pipeline, the Send screen, and the Messages screen are
part B and are not built yet. Part A is the live release `86d0846`; the record is
[`docs/reports/phase-3a.md`](docs/reports/phase-3a.md). Phase 2 (contacts, templates, and number
lookup), Phase 1
(accounts), and Phase 0 (foundation and production hosting) remain underneath it.

## Repository layout

```
apps/
  web/        Next.js 16 app: landing page, accounts, contacts, templates, senders, admin, lookup
  api/        NestJS + Fastify REST API (/api/*, /healthz, /readyz)
  worker/     NestJS worker: heartbeat and a nightly ledger check (queues arrive with sending)
  migrate/    One-shot container: Prisma migrations, then the demo seed
packages/
  config/     Shared ESLint, Prettier and TypeScript presets
  shared/     Env validation, auth, the SMS library, pricing, the mock provider, and roles
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
the api and worker start, and the migrate container seeds the demo account. Check readiness
with `curl http://localhost:8080/readyz`.

Sign in at <http://localhost:8080/signin> with `admin@smsvio.test` / `smsvio-demo-local`.
That password is for this local stack only; the production migrate container refuses it.
`.env.example` sets `EMAIL_MODE=disabled`, so email registration is hidden and the password
form stays for that demo account. Set `EMAIL_MODE=smtp` to use Mailpit at
<http://localhost:8025> for verification, reset, and invitation mail. Set `GOOGLE_CLIENT_ID`
and `GOOGLE_CLIENT_SECRET` together to show "Continue with Google". The redirect URIs are in
[docs/DEPLOY.md](docs/DEPLOY.md).

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
startup and exit with a list of the invalid keys. `PUBLIC_ORIGIN` in that file is
`http://localhost:3000` for `pnpm dev`. Compose overrides it inside the api container so cookies
match `http://localhost:8080`.

`pnpm --filter @smsvio/db migrate:deploy` applies migrations only. `node apps/migrate/seed.mjs`
applies migrations, then seeds countries, dial codes, networks, the simulated mock provider, and
the shared sender. It creates the demo account when `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`
are set. It does not change the password of an account that already exists, and it does not
overwrite a country, network, provider markup, or shared sender that is already stored.
`AUTO_APPROVE_TEMPLATES=true` in `.env.example` approves a template when it is submitted. Leave
it false to keep the template pending for an operator.

Create a migration after changing `packages/db/prisma/schema.prisma`:

```bash
pnpm --filter @smsvio/db migrate:dev --name <change-name>
```

## Quality checks

| Command                 | What it does                                                          |
| ----------------------- | --------------------------------------------------------------------- |
| `pnpm lint`             | ESLint on every package (zero warnings) and Prettier check            |
| `pnpm typecheck`        | Strict TypeScript across the workspace                                |
| `pnpm test`             | Unit tests with coverage thresholds                                   |
| `pnpm test:integration` | API tests against real Postgres and Redis, including tenant isolation |
| `pnpm test:e2e`         | Playwright: light and dark themes at desktop and mobile sizes         |
| `pnpm build`            | Production build of every package                                     |
| `pnpm format`           | Format the repository with Prettier                                   |

Install the Playwright browser once with `pnpm --filter @smsvio/web exec playwright install chromium`.
The end-to-end tests fail on any browser console error or warning.

This machine does not run Docker or a local stack. Lint, typecheck, unit tests, and `pnpm build`
run here. Playwright, the Postgres integration tests, and the fresh-clone Compose smoke test run
in [CI](.github/workflows/ci.yml) on every pull request and every push to `main`. A push to
`main` deploys only after all three succeed.

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
