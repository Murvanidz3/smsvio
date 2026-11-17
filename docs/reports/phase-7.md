# Phase 7 — Carriers

Completed 2026-11-17. Spec section 15 Phase 7: an SMPP session, a generic HTTPS provider, inbound
messages, and delivery-receipt hardening. The staged live test was not run.

## Completeness

| Requirement                           | Status             | Where                                                                  |
| ------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| SMPP provider                         | Done, unconfigured | `apps/worker/src/smpp-link.ts`, `packages/shared/src/provider/smpp.ts` |
| Owner's HTTP provider                 | Partial            | `packages/shared/src/provider/http.ts`, `apps/worker/src/carrier.ts`   |
| Inbound messages                      | Done               | `packages/server/src/inbound.ts`                                       |
| Delivery-receipt hardening            | Done               | optional mock receipt, HTTP callback, SMPP `deliver_sm`                |
| Live test in at least three countries | Not run            | No carrier credentials and no handsets were available                  |

## What was built

An operator pastes SMPP or HTTP JSON into the existing provider form. The API encrypts it with
`APP_ENCRYPTION_KEY`. The worker decrypts it only for a live, billable send. Test keys stay on
the mock provider. Existing mock routes keep working.

A mock accept still schedules a receipt. An SMPP or HTTP accept does not. Receipts arrive later
on `POST /api/hooks/providers/<code>` (`x-smsvio-signature`) or as an SMPP `deliver_sm`, then
through the existing receipt state machine, including the one correction from expired to
delivered.

An inbound handset message is kept for the organization that most recently sent to that number.
Keyword handling is the Phase 6 auto-reply path. If no outbound message matches, the inbound
message is ignored.

The HTTP URL must be https and is pinned the same way as a webhook. SMPP is an in-process
transceiver. No SMPP library and no vendor SDK were added.

## How to verify

The same local gates as Phase 6. Shared branch coverage is 95.22%. API branch coverage is
80.02%. Worker branch coverage is 81.20%. No socket was opened to a carrier. The scripted SMPP
tests and the HTTP mapping tests cover the codecs. CI runs `apps/web/e2e/compliance.spec.ts`
for the dashboard page. It does not send to a handset.

No new environment variables were added. Carrier JSON shapes are in `docs/DEPLOY.md`.

## Known limitations

- No upstream host, system id, password, HTTP vendor, or price list was provided. None were
  invented. The live handset test in three countries was not run.
- SMPP multipart and the session window are implemented and covered by scripted sockets. Enquire
  link is sent on a 30 second timer and was not waited out in the unit test.
- A generic HTTP provider posts JSON `{ to, from, text }` and reads `id` plus a status map. A
  vendor with a different body still needs its own config, not a new code path, once the owner
  names one.
- Checkout remains 503 `payments_unconfigured`.
