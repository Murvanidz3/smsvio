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
SMSVIO Demo and captures mail in Mailpit when `EMAIL_MODE=smtp`.

Google sign-in uses the authorization-code flow with PKCE. The browser returns to
`/auth/google/callback`. With `EMAIL_MODE=disabled`, `/signup` is Google only, invitations
return a one-time link instead of an email, and phone verification is refused. `/signin` keeps
the password form. The verified address in `SEED_ADMIN_EMAIL` becomes the platform admin at
sign-in. An empty `SEED_ADMIN_PASSWORD` does not create a password user.

## How to verify

Unit tests, lint, typecheck, and the production build run without Docker:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

This development machine does not run Docker or a local stack. Lint, typecheck, unit tests, and
`pnpm build` were run here and passed. Playwright, the Postgres integration tests, and the
fresh-clone Compose smoke test run in GitHub Actions. They must pass before a phase is complete,
and the deploy does not start unless all three succeed.

Playwright covers demo sign-in, Users, Settings, the command palette, email sign-up, and Google
sign-in against a local mock. Each test fails on a browser console error or warning. Projects
are desktop and mobile, light and dark, plus Google on desktop light and mobile dark.

[CI run 43003460111](https://github.com/Murvanidz3/smsvio/actions/runs/43003460111) on `936fb77`
passed all six jobs, including the production deploy. `https://smsvio.com/readyz` returns
`{"status":"ok"}`. `https://smsvio.com/signin` shows **Continue with Google**, and
`/api/internal/auth/config` returns `emailMode: disabled` and `google: true`. The password form
stays on the sign-in page. "Forgot your password?" is hidden.

## Decisions

Recorded in `docs/DECISIONS.md` under Phase 1. The ones that change how the product behaves:

- Production runs with `EMAIL_MODE=disabled`. SMTP is required only when the mode is `smtp`.
  The local demo password is refused when `NODE_ENV` is production.
- Google sign-in, the public callback path, and the platform-admin email are recorded in
  `docs/DECISIONS.md`. Phone verification is hidden until SMS exists in Phase 3.
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
- Playwright, the Postgres integration tests, and the Compose smoke test are not run on this
  development machine. They passed in GitHub Actions on `936fb77`. The API unit suite was run
  here.

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
- While `EMAIL_MODE=disabled`, `startPhone` returns 403 `phone_unavailable`. Phase 3 should
  replace that refusal and the settings copy, not the code-attempt counter.
- `messageRetentionDays`, `dailySpendCapMicros`, and `smartEncoding` are already columns.
- The web content security policy allows `style-src-attr 'unsafe-inline'` and forbids injected
  style and script tags. Do not add a library that inserts either.
- Production `/opt/smsvio/.env` already has `PUBLIC_ORIGIN`, `APP_ENCRYPTION_KEY`,
  `EMAIL_MODE=disabled`, the Google client, and `SEED_ADMIN_EMAIL`. Do not regenerate that
  file. Local Compose sets `NODE_ENV=development` on the migrate service on purpose.
- Google's redirect URI is `/auth/google/callback` on `PUBLIC_ORIGIN`. Caddy proxies that path
  to the API. The callback is excluded from the `/api` prefix.
