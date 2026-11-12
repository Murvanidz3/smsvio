# Phase 3b — Send pipeline, Send, and Messages

Completed 2026-11-12. Spec sections 7.1–7.6, 10.4, and 10.8. Webhook delivery stays in Phase 4.
The OptOut table, keywords, auto-replies, and inbound storage stay in Phase 6. SMPP and HTTP
providers stay in Phase 7.

## Completeness

| Requirement                                                                              | Status  | Where                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 State machine, one MessageEvent per transition, late delivered after expired         | Partial | `packages/shared/src/sms/pipeline.ts`, `apps/worker/src/dispatch.ts`, `apps/api/src/messaging/send.service.ts`. Webhook enqueue is Phase 4.                                      |
| 7.2 Accept, including 24h Idempotency-Key and clientRef                                  | Partial | `apps/api/src/messaging/send.service.ts`, `messages.controller.ts`. Network MCC/MNC is not resolved, so the quote uses the country-wide route.                                   |
| 7.3 Route order, backoff, failover, throughput limit, expiry sweeper, charge and release | Done    | `apps/worker/src/dispatch.ts`, `apps/worker/src/send-loop.ts`. Receipts arrive on `sms.dlr` from `POST /api/hooks/providers/mock`.                                               |
| 7.4 Adapters                                                                             | Partial | `packages/shared/src/provider/mock.ts`. SMPP and HTTP are Phase 7.                                                                                                               |
| 7.5 Inbound and opt-out                                                                  | Partial | `Contact.optedOut` is checked in `send.service.ts`. The OptOut table, keywords, auto-replies, and inbound storage are Phase 6.                                                   |
| 7.6 Error codes with a human explanation                                                 | Done    | `packages/shared/src/sms/errors.ts`. The message drawer shows the code and `explain()`.                                                                                          |
| 10.4 Send, including the live Activity panel                                             | Done    | `apps/web/src/app/dashboard/send/page.tsx`. Server-sent events, with polling if the stream drops. An unverified organization can send only to its verified account phone.        |
| 10.8 Messages: search, filters, detail drawer, CSV                                       | Done    | `apps/web/src/app/dashboard/messages/page.tsx`, `apps/web/src/lib/messages.ts`, `apps/api/src/messaging/messages.service.ts`, `messages.controller.ts`, `exports.controller.ts`. |

## What was built

Accept reserves the quoted price, writes a `QUEUED` message and a `MessageEvent`, and pushes the
id onto `smsvio:q:sms.send`. The worker claims it, sends through the active mock provider, and
charges that same price once when the provider accepts. `costMicros` is the route that was used.
A failed send releases the hold. Duplicate queue entries do not send twice. A temporary failure
retries the same route three times, then the next route. A permanent failure moves on immediately.
No remaining route fails the message with `no_route`.

Delivery receipts for the mock provider arrive at `POST /api/hooks/providers/mock` and are applied
from `sms.dlr`. A repeated receipt is ignored. A late `delivered` after `expired` is applied.
Daily spend is summed in the database. The organization send ceiling stays 20 per second unless
`ORG_SENDS_PER_SECOND` is set for a local run.

## Load test

The workflow is manual (`workflow_dispatch` on `.github/workflows/load-test.yml`). It starts the
local Compose stack and refuses any host other than localhost. It does not call production.

[Load test run 43228126966](https://github.com/Murvanidz3/smsvio/actions/runs/43228126966) on
`e418d00588fe3aba1704d8dd8e7c198fbe357606` printed:

```json
{
  "accepted": 60000,
  "rejected": 0,
  "elapsedMs": 626406,
  "lost": 0,
  "doubleCharges": 0,
  "ledgerDifferences": 0
}
```

Lost messages, double charges, and ledger-versus-balance differences are all zero.

## How to verify

This development machine does not run Docker, so Send and Messages were not clicked in a local
browser. Playwright in CI is the UI check, on desktop and mobile, light and dark.

[CI run 43228069710](https://github.com/Murvanidz3/smsvio/actions/runs/43228069710) on
`e418d00588fe3aba1704d8dd8e7c198fbe357606` passed lint, unit tests, integration tests, Playwright,
the Compose smoke test, the image build, and **Deploy to production**. A direct request to
`https://smsvio.com/readyz` returned HTTP 200 with `"status": "ok"` for Postgres and Redis.
That commit is the live release.

`AUTO_APPROVE_TEMPLATES` stays `false` in the repository. Production `/opt/smsvio/.env` sets it
to `true` until the admin review queue ships in Phase 6, and then it returns to `false`.

## Known limitations

- Network MCC/MNC is not resolved. Quotes use the country-wide route.
- SMPP and HTTP providers are not implemented.
- Opt-out is the contact flag only. Keywords, auto-replies, and inbound storage are not built.
- Webhook delivery is not built.
- The nightly ledger difference is still a log line. There is no operator alert channel.
