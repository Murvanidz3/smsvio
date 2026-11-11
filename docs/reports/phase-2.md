# Phase 2 — SMS library, contacts, templates, lookup

Completed 2026-11-11. Spec section 15. Phase 3 has not been started.

## What was built

Section 6 is a shared library: GSM-7 and UCS-2 segmentation, smart encoding, sender checks,
template variables, a six-sample gallery, CSV parsing, and phone normalisation with
libphonenumber. Time zones come from the vendored libphonenumber prefix map. The browser
imports the library without the phone metadata.

Contacts (10.5), templates (10.3), and number lookup (10.14) are real pages. A member with the
messaging capability can create a contact, import a CSV with a reject report, and delete a
contact after confirmation. The contact drawer shows up to 20 messages for that number.
Templates can be started from scratch, from the gallery, or from a JSON definition. The editor
has undo and redo, variables, a live encoding footer, and preview, checks, and API tabs. Save
keeps a draft. Submit leaves the template pending unless `AUTO_APPROVE_TEMPLATES=true`.
Analytics read sent, delivered, and failed counts for 7, 30, or 90 days. Number lookup returns
validity, E.164, international and national formats, country, region, type, and time zones, and
is limited to 30 lookups a minute.

The sidebar groups the pages that exist: Overview, Templates, Contacts, Users, Settings, Number
lookup, and support mail. Every catalog query is scoped by `organizationId`. Another
organization's contact or template id returns 404.

Countries are seeded on every migrate, including US and CA as alphanumeric-blocked and
registration-required. Existing country rows are left as they are.

## How to verify

Unit tests, lint, typecheck, and the production build run without Docker:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

This development machine does not run Docker or a local stack, so the new pages were not
clicked in a local browser. Lint, typecheck, unit tests, and `pnpm build` were run here and
passed. Playwright, the Postgres integration tests, and the fresh-clone Compose smoke test run
in GitHub Actions.

Playwright signs in as the demo owner, creates a unique contact, deletes it, copies the
sign-in sample, submits it, and looks up `+14155552671`. The integration test creates a
contact and a template in one organization and checks that the other organization receives 404
for get, update, and delete.

[CI run 43073786031](https://github.com/Murvanidz3/smsvio/actions/runs/43073786031) on `e75d90d`
passed lint, unit tests, integration tests, Playwright, the Compose smoke test, the image
build, and the production deploy. `https://smsvio.com/readyz` returns `{"status":"ok"}`.

## Decisions

Recorded in `docs/DECISIONS.md` under Phase 2.

- Phone metadata stays off the client barrel. Account forms keep the E.164 regex.
- US and CA seed rules block alphanumeric senders and require registration. Other countries
  start allowed. Reseeding does not overwrite those rows.
- The gallery is code. `AUTO_APPROVE_TEMPLATES` defaults to false, and the production env file
  was not changed.
- `Message` is queried for history and analytics. Nothing writes a message until Phase 3.
- The editor shows `POST /api/v1/messages` snippets. That route is not served yet.

## Known limitations

- No send pipeline, sender ids, routes, prices, or public API. A contact's history and a
  template's chart stay empty until Phase 3 writes messages.
- Production template submit stays `PENDING` until an operator can review it in Phase 6.
- Opt-out can be filtered and is not changed from the dashboard.
- Phone verification still returns `403 phone_unavailable` while email is disabled.
- Playwright, the Postgres integration tests, and the Compose smoke test were not run on this
  machine. They passed in GitHub Actions on `e75d90d`.

## What Phase 3 needs to know

- Write `Message` rows with `organizationId`. Contact history matches `to`, and template
  analytics match `templateId`. Status values are the uppercase enum. `from` is the column
  `fromSender`.
- `templateCanBeSent` is true only for `APPROVED`. Submit already rejects `message_too_long`.
- Sender rules come from `Country.alphaSenderAllowed`, not from a hardcoded country list.
- `startPhone` still returns `phone_unavailable` before it stores a number when
  `EMAIL_MODE=disabled`. Replace that refusal when SMS can send the code.
- Do not regenerate `/opt/smsvio/.env`. `AUTO_APPROVE_TEMPLATES` stays false there.
- Catalog mutations already require the session cookie, `Origin`, and `x-csrf-token`.
