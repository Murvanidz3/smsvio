# Phase 1 — Accounts and shell

Completed 2026-11-11. Spec section 15. Phase 2 has not been started.

## What was built

People can create an account, confirm their email, sign in at `/signin`, reset a password, and
turn on TOTP two-factor authentication. Sessions last 30 days, can be revoked, and are limited
to one organization at a time. An owner can invite members, change roles, transfer ownership,
and delete the organization by typing its name. Two organizations cannot see each other's
members.

The dashboard shell (spec 10.1) has a sidebar, a mobile menu, a command palette, an organization
switcher, a role badge, theme switching, and sign-out. Overview, Users (10.11), and Settings
(10.12) are real pages. Settings covers profile, password, two-factor authentication, sessions,
the audit log, phone and contact details, and business details. Every sensitive action writes an
audit row. Any member can read the organization's audit list.

The local stack seeds `admin@smsvio.test` / `smsvio-demo-local` in an organization named
SMSVIO Demo and captures mail in Mailpit.

## How to verify

Unit tests, lint, typecheck, and the production build run without Docker:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Integration tests and Playwright need Postgres and Redis. They run in CI. On a machine with
Docker they also run locally:

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm test:integration
pnpm test:e2e
```

Playwright starts the built API on `127.0.0.1:4010`, seeds the demo account, and opens the web
app on `127.0.0.1:3100`. It covers demo sign-in, Users, Settings, the command palette, and a
sign-up that reads the verification link from the mail sink. Each test fails on a browser
console error or warning. The four projects are desktop and mobile, light and dark.

The fresh-clone gate is `cp .env.example .env && docker compose up --build --wait`, then
sign in at `http://localhost:8080/signin` with the demo account. Mail is at
`http://localhost:8025`. This machine does not have Docker, so that gate was not run here. CI
runs `docker compose up --wait` from `.env.example`.

Production images will not become ready until `/opt/smsvio/.env` contains `PUBLIC_ORIGIN`,
`APP_ENCRYPTION_KEY`, `SMTP_HOST`, and `SMTP_FROM`. `deploy.sh` rolls back when `/readyz` fails.
Do not deploy this phase until those values are set. See `docs/DEPLOY.md`.

## Decisions

Recorded in `docs/DECISIONS.md` under Phase 1. The ones that change how the product behaves:

- SMTP credentials and the platform admin email were not supplied. They are environment
  variables. Local mail goes to Mailpit. Production fails fast without the required keys.
  The local demo password is refused when `NODE_ENV` is production.
- Phone verification emails the code. The UI says so. SMS does not exist until Phase 3.
- The shell links only to Overview, Users, Settings, and support mail. The verification banner
  opens Settings → Business. There is no placeholder compliance page and no fake metric.
- Internal errors are `{ code, message, fields? }`. Nest's 404 body for unknown routes is
  unchanged.
- Deleting an organization writes the audit row with a null `organizationId` so the cascade
  does not destroy the record of the deletion.
- `AuthToken` stores verification, reset, and phone codes. It is not in the spec's section 8
  diagram.
- Users is a plain HTML table. The command palette and toasts are custom so they do not inject
  style tags under the nonce content security policy.

## Known limitations

- No SMS, templates, numbers, billing, or public API. Those are later phases.
- Organization suspension does not block sign-in. It will matter when sending exists.
- Phone numbers are checked with an E.164 pattern, not libphonenumber.
- `dailySpendCapMicros` is null. `smartEncoding` is stored and unused. Message retention
  defaults to 365 days and is not enforced.
- Replacing `APP_ENCRYPTION_KEY` does not re-encrypt TOTP secrets. Affected users set up
  two-factor authentication again.
- The admin console is Phase 6. The demo user is a platform admin only so the flag is seeded.
- `@tanstack/react-table` and `cmdk` are installed and unused.
- A membership status other than `ACTIVE` does not exist yet, so suspension of a member is not
  represented.
- Playwright and the Compose smoke test were not executed on this development machine because
  Docker and a local Postgres are not installed. The API unit suite, including the in-memory
  two-organization cases, was run here.

## What Phase 2 needs to know

- Sign-in, cookies, and `Origin` / `x-csrf-token` are enforced for `/api/internal`. New
  mutations must send both. Cross-tenant ids return 404.
- `ApiErrorFilter` must stay registered after `SentryGlobalFilter` in `configureApp`.
- Session and organization context are on `request.auth` after `SessionGuard`. Capabilities
  are `view`, `messaging`, `developer`, `compliance`, `billing`, `manage`, and `own`.
- `PENDING_VERIFICATION` is the status of every new organization. Do not invent a compliance
  route; the banner already points at Settings → Business.
- Password hashing must keep using `ARGON2ID_OPTIONS`. Encryption of new secrets must keep the
  `v1.` prefix and `APP_ENCRYPTION_KEY`.
- Rate-limit keys are `smsvio:rl:` plus a hash, not a raw email address.
- The phone-verification email is the stand-in for SMS. Phase 3 should replace the delivery
  in `startPhone` / `confirmPhone` and the settings copy, not the code-attempt counter.
- `messageRetentionDays`, `dailySpendCapMicros`, and `smartEncoding` are already columns.
- The web content security policy allows `style-src-attr 'unsafe-inline'` and forbids injected
  style and script tags. Do not add a library that inserts either.
- Production `/opt/smsvio/.env` still needs the Phase 1 keys before the next deploy. Local
  Compose sets `NODE_ENV=development` on the migrate service on purpose.
