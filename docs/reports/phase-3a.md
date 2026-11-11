# Phase 3a — Routes, rates, senders, and the ledger

Completed 2026-11-12. Spec sections 8, 9.1–9.2, 10.6, and the organization balance controls in
10.15. Part B (the send pipeline, Send, and Messages) has not been started.

## What was built

Each provider has a required markup. A route can override it for one country or network. The
customer price per segment is the primary route's cost times `(1 + effective markup / 100)`,
rounded up to the nearest 100 micros. The primary route is the enabled route on an active
provider with the best priority. Overrides, highest first, are a per-customer org rate, then a
manual country rate, then that computed price. Prices are computed when they are read.

The admin Routes screen shows provider cost, the markup in effect and where it comes from, the
customer price, and the margin. The Rates screen shows whether each price is computed, manual,
or per-customer. There is no global markup and no minimum margin.

A new organization's daily spend cap stays empty and inherits the platform setting, which starts
at 20,000,000 micros (20 USD). An admin can change the platform value and can set or clear a
per-organization override. The cap is not enforced until send exists.

The ledger holds, charges, releases, and adjusts balances in integer micros. An admin credit or
debit requires a reason and is audit-logged in the same transaction. The worker checks the ledger
against the balance once per UTC day and logs any difference. MockProvider is seeded and never
contacts a network. Customers can enable a country on the shared sender `12025550199` and can
request a sender. Requests stay pending.

## How to verify

Unit tests, lint, typecheck, and the production build run without Docker:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

This development machine does not run Docker or a local stack, so the new screens were not
clicked in a local browser. Playwright, the Postgres integration tests, and the fresh-clone
Compose smoke test run in GitHub Actions.

Playwright signs in as the demo owner, enables one country per project, credits 1.00 USD with a
reason, and checks the seeded mock route: 50% from the provider, source `computed`, price
`0.0150`. The integration test checks that another organization's sender and country return 404.

[CI run 43100096279](https://github.com/Murvanidz3/smsvio/actions/runs/43100096279) (run 22) on
`772d127f581fbc53316a868928d9d6e12ac4882e` passed lint, unit tests, integration tests,
Playwright, the Compose smoke test, the image build, and **Deploy to production**. That job
ran; it was not skipped. The deploy log records
`release 772d127f581fbc53316a868928d9d6e12ac4882e is live on https://smsvio.com`, and the job's
public check got `ok` for `/readyz`, `/`, and `/signin`. A direct request to
`https://smsvio.com/readyz` returned HTTP 200 with `"status": "ok"` for Postgres and Redis.
That commit is the live release.

No test file was deleted between `850d3eb` and `772d127`. Nothing was skipped or marked fixme.
The worker heartbeat expectations count one extra Redis write because the nightly sweep takes
its lock, and the worker env test now requires `DATABASE_URL`. Both are exact checks of the new
behavior. `.github/workflows/ci.yml` at `772d127` matches `850d3eb`. A commit in between gave
each push its own concurrency group; the next commit put the branch group back.

## Decisions

Recorded in `docs/DECISIONS.md` under Phase 3a.

- Markup is per provider, with an optional route override. No global markup and no minimum margin.
- The quoted price is what the customer will be charged. The route actually used will store its
  own `costMicros`, so failover can show a negative margin. Charging is Part B.
- A null organization spend cap inherits the platform setting.
- Real phone verification stays deferred. Only MockProvider routes exist, and nothing leaves the
  platform. Sender review and registration completion stay in Phase 6.
- `AUTO_APPROVE_TEMPLATES` was not changed.

## Known limitations

- No send pipeline, Send screen, or Messages screen. The spend cap is stored and is not enforced.
- Sender requests stay `PENDING`. Networks are not seeded. `Route.mccmnc` is not a foreign key.
- The nightly ledger difference is an error log. There is no operator alert channel.
- The customer rate table and the pricing calculator page are Phase 5. The price function and the
  Senders country dialog already show the current price.
- Playwright, the Postgres integration tests, and the Compose smoke test were not run on this
  machine. They passed in GitHub Actions on `772d127`.

Runs 19 (`43097731944`, `2480775`) and 20 (`43098371624`, `e6e1bb3`) are still listed as queued
and have no jobs. Cancel and force-cancel return HTTP 409, "Cannot cancel a workflow run that
has not been queued yet." The signed-in Cancel workflow button returns "Failed to cancel
workflow." They are not deploying. If GitHub later creates their jobs, those commits could
deploy over `772d127`.

## What Part B needs to know

- Charge the quoted price for the destination. Store `costMicros` from the route that actually
  sent, including when failover uses a different provider.
- Enforce the effective daily spend cap. Null on the organization means the platform setting.
- Real phone verification is still deferred. Keep `AUTO_APPROVE_TEMPLATES` false in
  `/opt/smsvio/.env` until the Phase 6 review queue exists.
- Do not regenerate `/opt/smsvio/.env`.
