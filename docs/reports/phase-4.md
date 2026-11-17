# Phase 4 — API keys, public API, and webhooks

Completed 2026-11-17. Spec sections 10.9, 10.10, and 12. Webhook delivery, left open in Phase 3b,
is included. SMPP, payments, compliance queues, and operator screens stay in later phases.

## Completeness

| Requirement                                                                                     | Status | Where                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| 10.9 API keys: copy organization id, masked table, enable, disable, rename, delete, secret once | Done   | `apps/web/src/app/dashboard/api-keys/page.tsx`, `apps/api/src/developer/keys.service.ts`                         |
| 10.9 `svk_live_` / `svk_test_`, hash, prefix, last four; test keys do not charge                | Done   | `packages/shared/src/developer/node.ts`, `apps/api/src/messaging/send.service.ts`, `Message.billable`            |
| 10.10 Webhook table, grouped events, detail, reveal, rotate, delivery log, replay, test event   | Done   | `apps/web/src/app/dashboard/webhooks/page.tsx`, `apps/web/src/app/dashboard/webhooks/[id]/page.tsx`              |
| 10.10 Standard Webhooks, retries for about 24 hours, disable and email, SSRF-safe POST          | Done   | `apps/worker/src/webhook-deliver.ts`, `apps/worker/src/webhook-post.ts`, `apps/worker/src/webhook-loop.ts`       |
| 12 Public REST `/api/v1` with key auth, cursor pages, problem+json                              | Done   | `apps/api/src/developer/public.controller.ts`, `apps/api/src/developer/public.service.ts`                        |
| 12 OpenAPI reference at `/docs` with cURL, Node, Python, PHP, and a signature guide             | Done   | `apps/web/src/app/docs/page.tsx`, `packages/shared/src/developer/openapi.ts`                                     |
| 7.1 Every transition also enqueues customer webhooks                                            | Done   | `apps/api/src/messaging/send.service.ts`, `apps/worker/src/dispatch.ts`, `packages/server/src/customer-event.ts` |

## What was built

Dashboard users with the developer capability can create live and test keys and manage webhook
endpoints from the existing shell. The public API accepts `x-api-key` or `Authorization: Bearer`,
returns snake_case JSON, and uses RFC 9457 problem details. `POST /api/v1/messages` returns 202.
A batch of up to 1,000 messages returns 200 with one result per item.

Test keys store the quoted price and set `billable` false. The ledger is not touched and the
daily spend cap is not applied. Dispatch is unchanged: only active mock providers send.

Each message transition writes a `MessageEvent` and enqueues matching webhook deliveries.
Delivery signs the raw body with HMAC-SHA256, retries on the Redis delay set for about 24 hours,
and disables the endpoint when that schedule is exhausted. Owners and admins are emailed when
`EMAIL_MODE=smtp`. With email disabled, the endpoint is still disabled and the worker logs that
no mail was sent.

`/docs` is rendered by the app. It does not load Swagger or Scalar. `GET /api/v1/openapi.json`
is public.

## How to verify

This machine ran the local gates from section 14: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
and `pnpm build`. Shared branch coverage is 95.5%. API branch coverage is 80.17%. Docker and a
local browser were not used here, so the dashboard pages and `/docs` were not clicked on this
machine. Playwright coverage is `apps/web/e2e/developer.spec.ts`, which CI runs with the rest of
the suite. Production comes up when this commit is deployed from `main`.

`AUTO_APPROVE_TEMPLATES` stays `false` in the repository. Production `/opt/smsvio/.env` sets it
to `true` until the admin review queue ships in Phase 6.

The worker now requires `APP_ENCRYPTION_KEY`, the same key the api already uses. No new secret
was added. See `docs/DEPLOY.md`.

## Known limitations

- Inbound SMS is not stored, so `message.received` can be selected and is not emitted.
- Network MCC/MNC is not resolved. Quotes use the country-wide route.
- SMPP and HTTP providers are not implemented. Dispatch still uses active mock providers.
- There is no payment or top-up webhook. Billing events are charge, release, and adjustment.
- Opt-out is the contact flag only. Keywords, auto-replies, and the compliance queue are Phase 6.
