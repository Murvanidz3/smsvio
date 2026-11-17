# Phase 5 — Billing and analytics

Completed 2026-11-17. Spec sections 9.3, 10.2, 10.13, and 10.14, plus auto-recharge, low-balance
email, and the daily usage rollup. Compliance queues, opt-out keywords, and SMPP or HTTP providers
stay in later phases.

## Completeness

| Requirement                                                                                    | Status          | Where                                                          |
| ---------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------- |
| 9.3 Minimum 10 USD, no card data on our servers, credit only after a verified provider webhook | Partial         | `apps/api/src/billing/billing.service.ts`                      |
| 10.13 Billing: balance, add credit, payment methods, history, receipt, preferences             | Done            | `apps/web/src/app/dashboard/billing/page.tsx`                  |
| 10.13 Auto-recharge settings and low-balance email                                             | Partial         | `BillingProfile`, `apps/worker/src/usage-pass.ts`              |
| 10.2 Overview cards, ranges, daily chart, recent contacts, verification note                   | Done            | `apps/web/src/app/dashboard/page.tsx`                          |
| Daily statistics every 15 minutes                                                              | Done            | `DailyUsage`, `apps/worker/src/usage-loop.ts`                  |
| 10.14 Calculator, rates, CSV, copy                                                             | Done            | `apps/web/src/app/dashboard/tools/pricing/page.tsx`            |
| Template analytics                                                                             | Already shipped | `apps/web/src/app/dashboard/templates/[id]/analytics/page.tsx` |

## What was built

Owners, admins, and billing members can open Billing from the existing shell. Everyone can open
Pricing. Overview counts templates, contacts, deliverability, balance, and messages for today,
7, 30, or 90 UTC days, or a custom range of at most 90 days. The chart is the same SVG approach
used for template analytics.

Checkout does not charge a card. A top-up under 10 USD is 400. A valid amount is 503
`payments_unconfigured` and writes nothing. No payment provider was chosen, so no adapter and no
new secret were added. Auto-recharge is saved and reported as `idle` or `below_threshold`. The
worker does not debit a card.

The worker rewrites the last 90 UTC days of `DailyUsage` every 15 minutes. Overview does not wait
for that pass; it counts messages when the page opens. A low-balance notice goes out once to
active owners, admins, billing members, and the billing email. With email disabled, the worker
logs and still records the notice. Recovery to the threshold or above arms it again.

A ledger receipt downloads as `text/plain`. An empty note uses the ledger type as the description.
The verification banner points at Settings until the compliance page exists.

## How to verify

This machine ran the local gates from section 14: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
and `pnpm build`. Shared branch coverage is 95.65%. API branch coverage is 81.21%. Worker branch
coverage is 81.08%. Docker and a local browser were not used here, so the dashboard pages were
not clicked on this machine. Playwright coverage is `apps/web/e2e/billing.spec.ts`, which CI runs
with the rest of the suite. Production comes up when this commit is deployed from `main`. The
migrate job creates `billing_profiles` and `daily_usage`.

`AUTO_APPROVE_TEMPLATES` stays `false` in the repository. Production `/opt/smsvio/.env` sets it
to `true` until the admin review queue ships in Phase 6.

No payment environment variables were added. See `docs/DEPLOY.md`.

## Known limitations

- Online checkout is closed. A balance still changes through the existing admin adjustment and
  through message holds, charges, releases, and refunds.
- Auto-recharge is not charged. There is no hosted card page and no saved payment method.
- A top-up receipt email waits for a provider. The downloadable ledger receipt is available now.
- There is no `billing.topped_up` webhook.
- The verification banner does not open a compliance form. That form is Phase 6.
- SMPP and HTTP providers are not implemented. Dispatch still uses active mock providers.
