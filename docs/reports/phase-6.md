# Phase 6 — Compliance and the operator console

Completed 2026-11-17. Spec sections 10.7, 7.5, and the rest of 10.15, plus the fraud controls that
were already named: enabled countries, organization status, the verified-phone exception, and a
durable opt-out list.

## Completeness

| Requirement                                                | Status | Where                                                                         |
| ---------------------------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| 10.7 Business, use cases, documents, auto-replies          | Done   | `apps/web/src/app/dashboard/compliance/page.tsx`                              |
| 7.5 Opt-out, opt-in, help, custom keywords                 | Done   | `packages/shared/src/compliance/replies.ts`, `packages/server/src/inbound.ts` |
| 10.15 Review queues, message search, health, margin, audit | Done   | `apps/web/src/app/admin/reviews/page.tsx` and the sibling admin pages         |
| Fraud controls without invented velocity limits            | Done   | existing send checks plus `OptOut`                                            |

## What was built

Owners and admins open Compliance from the shell. The business form locks while a submission is
waiting and opens again after a rejection. Approval sets the organization to `ACTIVE`. Use cases
enter the same operator queue as senders and templates. Documents are encrypted in Postgres with
the existing application key, up to 512 KB.

Default replies for stop, start, and help are created on first view or first inbound message.
Keywords are whole tokens. An opt-out is stored even if the contact is later deleted, and send
checks that list. The confirmation is unbilled.

The admin rail adds Reviews, Messages, Health, Margin, and Audit. The overview banner links to
`/dashboard/compliance`.

## How to verify

This machine ran the local gates from section 14: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
and `pnpm build`. Shared branch coverage is 95.22%. API branch coverage is 80.02%. Worker branch
coverage is 81.20%. Server branch coverage is 100%. Docker and a local browser were not used
here, so the new pages were not clicked on this machine. Playwright coverage is
`apps/web/e2e/compliance.spec.ts`, which CI runs with the rest of the suite. The migrate job
creates the compliance tables.

`AUTO_APPROVE_TEMPLATES` stays `false` in the repository. Production `/opt/smsvio/.env` may still
be `true` until the owner turns it off. The review queue is available either way.

No new environment variables were added. See `docs/DEPLOY.md`.

## Known limitations

- Online checkout is still closed. Phase 5's 503 `payments_unconfigured` is unchanged.
- A rejected business can be submitted again. An approved organization cannot submit a second profile.
- Default replies can race into duplicates if two first views happen together. There is no unique
  constraint on category.
- No numeric velocity or fraud score was added.
