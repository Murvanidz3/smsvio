# SMSVIO — Master Build Prompt

> **How to use this file (owner):** save it in the project as `docs/SPEC.md`. In Cursor (Agent mode) send the short kickoff message from section 17. Cursor then builds one phase at a time and stops for your review after each phase. Do not paste the whole build as "do everything now" — phased work is what keeps it bug-free.

---

## 1. Your role and working rules

You are the lead engineer building **SMSVIO**, a production, multi-tenant, worldwide **SMS-only** messaging platform. This document is the single source of truth. Follow it exactly.

**Rules you must obey for the entire project:**

1. **Work in phases** (section 15). Do only the phase you were asked to do. When a phase is finished, run every quality gate in section 14, fix every failure, write a short report (what was built, how to verify, open questions) and **stop**.
2. **Never guess.** If something in this spec is ambiguous, or you need a credential or decision listed in section 16, ask before writing code that depends on it. Record every decision in `docs/DECISIONS.md`.
3. **No fake completeness.** No `TODO`, no placeholder handlers, no hard-coded demo data in production paths, no silently swallowed errors. The only simulated component allowed is `MockProvider` (section 7.4).
4. **Strict TypeScript everywhere.** `strict: true`, `noUncheckedIndexedAccess: true`, no `any`, no `@ts-ignore`. Validate every external input (HTTP body, query, env, provider callback, CSV) with zod.
5. **Do not invent library APIs.** Before using a library, read the documentation for the version actually installed. Install the latest stable release of each dependency, use the current active Node.js LTS, and commit the lockfile.
6. **Secrets never enter git.** Maintain `.env.example` with every variable documented. Validate env at boot and fail fast with a clear message.
7. **Every tenant-owned query is scoped by `organizationId`.** There is no exception. Cross-tenant access must return 404 and must be covered by tests.
8. **Money is never a float.** Use integer micro-units (section 9).
9. **Original product.** The layout is inspired by modern messaging dashboards, but the name, logo, colours, icons, wording and assets must be our own. Do not copy text, branding or assets from any other product.
10. **Small commits** with conventional commit messages. Keep `README.md`, `docs/DEPLOY.md` and `docs/DECISIONS.md` up to date as you go.

---

## 2. Product summary

SMSVIO lets businesses send SMS to any country through a web dashboard and a REST API.

A customer (an **organization**) signs up, verifies its business, tops up a prepaid balance, registers sender IDs and destination countries, creates message templates, sends SMS, and tracks delivery in real time. Developers integrate using API keys and receive status updates through signed webhooks. The platform operator (us) manages upstream carriers, routing, prices, and approvals from an internal admin console.

**In scope:** SMS only (outbound, delivery receipts, and inbound replies where the upstream supports them).

**Explicitly out of scope — do not build, do not add UI for, do not add "coming soon" tabs for:** WhatsApp, RCS, MMS, voice, email marketing, chat inbox, AI message writing. There is no "channel" selector anywhere in the product.

**Also out of scope for now:** the public marketing site. `https://smsvio.com/` shows only a minimal branded placeholder with a "Sign in" button. The owner will build the real front page later, so keep it isolated in its own route group so it can be replaced without touching the app.

---

## 3. URLs and routing

Everything is served from one domain: **smsvio.com** (`www.smsvio.com` redirects permanently to the apex).

| Path | Purpose |
|---|---|
| `/` | Placeholder landing page (isolated route group) |
| `/signin` | **Main entry to the panel.** Sign-in page |
| `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invite` | Auth flows |
| `/dashboard` | Overview |
| `/dashboard/templates`, `/dashboard/templates/new`, `/dashboard/templates/[id]` | Templates |
| `/dashboard/send` | Send a message (test console) |
| `/dashboard/contacts` | Contacts |
| `/dashboard/senders` | Destination countries and sender IDs |
| `/dashboard/compliance` | Business verification, use cases, documents, auto-replies |
| `/dashboard/messages` | Message log (activity) |
| `/dashboard/api-keys` | API keys |
| `/dashboard/webhooks` | Webhooks |
| `/dashboard/users` | Team members |
| `/dashboard/settings` | Organization and personal settings |
| `/dashboard/billing` | Balance, top-ups, history, preferences |
| `/dashboard/tools/number-lookup` | Phone number lookup |
| `/dashboard/tools/pricing` | Pricing calculator and rate table |
| `/admin/**` | Platform operator console (platform admins only) |
| `/docs` | Public API reference generated from OpenAPI |
| `/api/v1/**` | Public REST API (API-key auth) |
| `/api/internal/**` | Dashboard API (session-cookie auth) |
| `/api/hooks/providers/:providerCode` | Upstream delivery receipts and inbound messages |
| `/api/hooks/payments/:provider` | Payment provider webhooks |
| `/healthz`, `/readyz` | Liveness / readiness |

An unauthenticated visit to any `/dashboard/**` or `/admin/**` path redirects to `/signin?next=<path>`. A signed-in visit to `/signin` redirects to `/dashboard`. Validate `next` so it can only be a same-origin relative path.

---

## 4. Tech stack

- **Monorepo:** pnpm workspaces + Turborepo.
- **`apps/web`:** Next.js (App Router) + React + TypeScript, Tailwind CSS, shadcn/ui, lucide-react, TanStack Query, TanStack Table, react-hook-form + zod, Recharts, next-themes, cmdk.
- **`apps/api`:** NestJS on the Fastify adapter. REST only. zod validation shared with the web app. OpenAPI document generated from the same schemas.
- **`apps/worker`:** NestJS standalone application running BullMQ processors (same codebase modules as the API, separate entrypoint and container).
- **`packages/db`:** Prisma schema, migrations, seed, generated client.
- **`packages/shared`:** zod schemas, shared types, error codes, and the pure SMS library (encoding, segmentation, phone parsing, sender validation).
- **`packages/config`:** shared ESLint, Prettier, tsconfig.
- **Data:** PostgreSQL (latest stable major) and Redis (latest stable major). Queues with BullMQ.
- **Phone numbers:** `libphonenumber-js` (max metadata).
- **Auth:** our own session auth — argon2id password hashes, opaque session tokens stored hashed in Postgres, `httpOnly; Secure; SameSite=Lax` cookie, optional TOTP 2FA.
- **Email:** Nodemailer over SMTP (credentials from env), React Email templates.
- **Payments:** behind a `PaymentProvider` interface (section 9.3).
- **Logging:** pino, structured JSON, request IDs. Optional Sentry enabled by env.
- **Tests:** Vitest (unit), Vitest + Supertest against real Postgres/Redis containers (integration), Playwright (end-to-end).
- **Deploy:** Docker Compose on Ubuntu 24.04, Caddy as reverse proxy with automatic HTTPS.

---

## 5. Architecture

```
Internet ──► Caddy (80/443, TLS)
               ├── /api/*  ──► api:4000   (NestJS/Fastify)
               └── /*      ──► web:3000   (Next.js)

api ──► PostgreSQL        api ──► Redis (rate limits, queues)
worker ──► Redis queues ──► upstream SMS providers (SMPP / HTTP)
upstream providers ──► /api/hooks/providers/:code ──► queue ──► worker
worker ──► customer webhook endpoints
```

- The web app calls the API on the same origin; no CORS for the dashboard. The public API allows no browser origins.
- The API never calls upstream SMS providers inline. It validates, prices, reserves balance, persists, and enqueues. The worker does the sending.
- Queues: `sms.send`, `sms.dlr`, `sms.inbound`, `webhook.deliver`, `stats.aggregate`, `billing.autorecharge`, `maintenance.sweep`, `export.csv`. Every job is idempotent and safe to retry.

---

## 6. SMS correctness (implement in `packages/shared`, pure functions, exhaustively unit-tested)

1. **Encoding detection.** GSM 03.38 basic character set plus the extension table. Extension characters (`^ { } \ [ ] ~ | €`) count as **two** septets. Any character outside GSM-7 switches the whole message to UCS-2.
2. **Segmentation.** GSM-7: 160 characters single, 153 per part when concatenated. UCS-2: 70 single, 67 per part. Count UCS-2 in UTF-16 code units and **never split a surrogate pair** (emoji) or an extension escape pair across segments.
3. **Limits.** Maximum 10 segments per message by default (admin-configurable). Reject longer messages with `message_too_long`.
4. **Smart encoding (per-org setting, default on).** Replace typographic characters (curly quotes, en/em dashes, non-breaking space, ellipsis) with GSM-7 equivalents before encoding detection. The UI must show which characters force UCS-2.
5. **Phone numbers.** Accept input in international format, normalise and store as E.164 (max 15 digits). Reject invalid or impossible numbers with `invalid_number`. Derive ISO country code.
6. **Sender IDs.** Alphanumeric: 3–11 characters, `[A-Za-z0-9 ]`, at least one letter. Numeric: digits only, up to 15. Validate per-country rules from the `Country` table (some countries do not allow alphanumeric senders).
7. **Template variables.** Syntax `{{name}}` with `[a-z0-9_]` names. Rendering fails with `missing_variable` if any variable is absent. Segment estimates in the editor use sample values.
8. Provide a fixture table of at least 60 cases (boundaries at 160/161, 153×n, 70/71, 67×n, extension characters at segment edges, emoji at segment edges, mixed scripts) and reach ≥ 95 % coverage on this package.

---

## 7. Message pipeline

### 7.1 Status state machine

`queued → sending → sent → delivered | undelivered | expired`
`queued | sending → failed` (never accepted by a carrier) · `rejected` (refused at validation, never queued)

Terminal states: `delivered`, `undelivered`, `expired`, `failed`, `rejected`. Transitions out of a terminal state are ignored. Delivery receipts may arrive duplicated or out of order — handling must be idempotent, and a late `delivered` after `expired` is the one permitted correction.

Every transition writes a `MessageEvent` row (the timeline shown in the UI) and enqueues a customer webhook.

### 7.2 Accept (API and dashboard share one service)

In order: authenticate → check organization status → validate payload → normalise number → resolve country (and network when known) → check destination country is enabled for the org → check sender ID is approved for that country (or fall back to the org's default for the country) → check opt-out list → render template → apply smart encoding → compute segments → look up price → enforce rate limit and daily spend cap → **atomically reserve balance** → insert `Message` (`queued`) + first event → enqueue `sms.send` → respond `202`.

Idempotency: `Idempotency-Key` header (or `client_ref` field) unique per organization for 24 h; a repeat returns the original response and creates nothing.

### 7.3 Send (worker)

Select routes for the destination (most specific match first: country+network, then country), ordered by priority then weight, skipping disabled or unhealthy providers. Call the provider adapter. On acceptance store `providerMessageId`, set `sent`, convert the reservation to a charge. On a temporary error retry with exponential backoff and jitter, then fail over to the next route. On a permanent error or exhausted routes set `failed` and release the reservation. Respect per-provider throughput limits (messages per second) with a Redis token bucket.

A sweeper marks messages still `sent` after the validity period (default 72 h) as `expired`.

### 7.4 Provider adapters

```ts
interface SmsProvider {
  readonly code: string;
  send(req: ProviderSendRequest): Promise<ProviderSendResult>;      // accepted | temporary_failure | permanent_failure
  verifyCallback(raw: RawHttpRequest): boolean;                      // signature / IP / secret check
  parseDeliveryReceipts(raw: RawHttpRequest): ProviderReceipt[];
  parseInbound?(raw: RawHttpRequest): ProviderInbound[];
  healthCheck(): Promise<ProviderHealth>;
}
```

Build these adapters:

- **`MockProvider`** — for development, tests and `svk_test_` API keys. Simulates acceptance and delayed delivery receipts. Magic destination suffixes produce deterministic outcomes (delivered, undelivered, failed, expired, slow). Never contacts a network.
- **`SmppProvider`** — SMPP 3.4 client: transceiver bind, `enquire_link` keep-alive, automatic reconnect with backoff, configurable window size and throughput, long messages via UDH concatenation, correct `data_coding` for GSM-7 and UCS-2, delivery receipts parsed from `deliver_sm` (both TLV and text formats), configurable source TON/NPI.
- **`HttpProvider` adapter(s)** — one per commercial upstream chosen by the owner (see section 16). Each maps the upstream's status codes and error codes into our normalised set.

Provider credentials are stored encrypted (section 11) and managed from the admin console. Adding a new provider must require only a new adapter class and a registry entry.

### 7.5 Inbound and opt-out

Where the upstream delivers inbound messages: store them as `direction = INBOUND`, match keywords case-insensitively against the org's auto-reply rules, and act: opt-out keywords add the number to `OptOut` and send the confirmation; opt-in keywords remove it; help keywords send the help text. Sending to an opted-out number is rejected with `recipient_opted_out`. Emit `message.received` webhooks.

### 7.6 Normalised error codes (stable, documented)

`invalid_number`, `invalid_sender`, `sender_not_approved`, `country_not_enabled`, `country_not_supported`, `registration_required`, `recipient_opted_out`, `message_too_long`, `missing_variable`, `template_not_approved`, `insufficient_balance`, `spend_cap_reached`, `rate_limited`, `organization_not_verified`, `organization_suspended`, `no_route`, `carrier_rejected`, `absent_subscriber`, `blocked_by_carrier`, `unknown_subscriber`, `expired`, `internal_error`. Each has a human explanation shown in the message detail drawer.

---

## 8. Data model (Prisma, PostgreSQL)

UUID primary keys. `createdAt`/`updatedAt` on every table. All tenant tables carry `organizationId` with an index. Use `citext` for emails.

- **User** — email (unique), passwordHash, name, emailVerifiedAt, totpSecretEnc, isPlatformAdmin, lastSeenAt.
- **Session** — userId, tokenHash, ip, userAgent, expiresAt, revokedAt.
- **Organization** — name, legalName, status (`PENDING_VERIFICATION | ACTIVE | SUSPENDED`), timezone, smartEncoding, dailySpendCapMicros, messageRetentionDays, taxIdType, taxId.
- **Membership** — userId, organizationId, role (`OWNER | ADMIN | DEVELOPER | BILLING | VIEWER`), status. Unique (userId, organizationId).
- **Invitation** — organizationId, email, role, tokenHash, expiresAt, acceptedAt.
- **ApiKey** — organizationId, name, mode (`LIVE | TEST`), prefix, keyHash (SHA-256), last4, status (`ACTIVE | DISABLED`), lastUsedAt, createdById.
- **Contact** — organizationId, phoneE164, countryCode, name, attributes (jsonb), optedOut. Unique (organizationId, phoneE164).
- **Template** — organizationId, name, category (`AUTHENTICATION | UTILITY | MARKETING`), language, body, variables (jsonb), status (`DRAFT | PENDING | APPROVED | REJECTED`), rejectionReason, createdById.
- **Country** — iso2 (PK), name, dialCode, alphaSenderAllowed, registrationRequired, notes, enabled.
- **Network** — mcc, mnc, countryIso2, name.
- **SenderId** — organizationId, type (`ALPHANUMERIC | LONG_CODE | SHORT_CODE`), value, status (`PENDING | APPROVED | REJECTED`), useCase, reviewNote.
- **OrgCountry** — organizationId, countryIso2, senderIdId (nullable = platform shared sender), registrationComplete. Unique (organizationId, countryIso2).
- **Provider** — code (unique), type (`MOCK | SMPP | HTTP`), configEnc, status, maxTps, callbackSecretHash, markupPercent (required; 50 means the customer price is cost + 50%).
- **Route** — countryIso2, mccmnc (nullable), providerId, priority (lower wins), weight, costMicros, markupPercent (nullable override of the provider markup), enabled. The customer price for a destination is the primary enabled route's cost times one plus the effective markup, rounded up to the nearest 100 micros. The route override wins over the provider markup. A manual Rate and an OrgRate replace that computed price. The customer is charged the quoted price even when failover uses another route; the message stores the cost of the route that was actually used.
- **Rate** — countryIso2, mccmnc (nullable), priceMicros, effectiveFrom. **OrgRate** — per-organization override.
- **Message** — organizationId, direction, to, from, body, templateId, templateVars, encoding, segments, countryIso2, mccmnc, status, errorCode, providerId, providerMessageId, routeId, priceMicros, costMicros, clientRef, apiKeyId, userId, scheduledAt, queuedAt, sentAt, deliveredAt, failedAt. Indexes: (organizationId, createdAt DESC), (organizationId, status, createdAt), (organizationId, to), unique (providerId, providerMessageId), unique (organizationId, clientRef).
- **MessageEvent** — messageId, status, detail, providerRaw (jsonb).
- **OrgBalance** — organizationId (PK), availableMicros, heldMicros.
- **LedgerEntry** — organizationId, type (`TOPUP | HOLD | CHARGE | RELEASE | REFUND | ADJUSTMENT`), amountMicros, balanceAfterMicros, refType, refId, note. Append-only.
- **Payment** — organizationId, provider, providerRef (unique), amountMicros, currency, status, receiptUrl.
- **BillingProfile** — organizationId, billingEmail, billingName, address fields, autoRechargeEnabled, autoRechargeThresholdMicros, autoRechargeAmountMicros.
- **WebhookEndpoint** — organizationId, name, url, secretEnc, events (text[]), status (`ACTIVE | DISABLED`), consecutiveFailures.
- **WebhookDelivery** — endpointId, eventId, eventType, payload, attempt, responseStatus, responseMs, nextRetryAt, status.
- **ComplianceProfile** — organizationId, business fields (legal name, entity type, registration country, website, role of contact, contact name/phone/email, address, tax ID), status (`DRAFT | SUBMITTED | APPROVED | REJECTED`), reviewNote, submittedAt.
- **UseCase** — organizationId, type, description, sampleMessages, optInMethod, status.
- **ComplianceDocument** — organizationId, countryIso2, docType, storageKey, fileName, size, mime.
- **AutoReply** — organizationId, category (`HELP | OPT_IN | OPT_OUT | CUSTOM`), keywords (text[]), replyText, isProtected, status.
- **OptOut** — organizationId, phoneE164, source. Unique (organizationId, phoneE164).
- **DailyStat** — organizationId, date, countryIso2, sent, delivered, undelivered, failed, segments, spendMicros. Unique (organizationId, date, countryIso2).
- **AuditLog** — organizationId, actorUserId, action, targetType, targetId, meta, ip.

Seed: all countries with dial codes, three protected auto-replies per new organization (help, opt-in, opt-out), a sample template gallery, a `MockProvider` with routes and rates for every country, and one platform admin from `SEED_ADMIN_EMAIL`.

---

## 9. Billing

### 9.1 Model
Prepaid balance in USD. One price per segment per destination (country, optionally network). No subscriptions, no per-contact platform fee.

### 9.2 Ledger rules
- 1 USD = 1,000,000 micros, stored as `BIGINT`. Convert to a display string only at the edge. Show balances with 2 decimals and per-message prices with 4.
- Reserve with a single conditional statement: decrement `availableMicros` and increment `heldMicros` only where `availableMicros >= amount`. Zero rows affected means `insufficient_balance`. Never read-then-write.
- Balance change and its `LedgerEntry` are written in the same transaction.
- Charge when a carrier accepts the message (`sent`). Release the hold when a message ends as `failed` or `rejected`.
- A nightly job verifies that the sum of ledger entries equals the stored balance for every organization and alerts on any difference.

### 9.3 Top-ups
`PaymentProvider` interface: `createTopUpSession`, `verifyWebhook`, `parseWebhook`, `chargeSavedMethod` (for auto-recharge), `getCustomerPortalUrl`. Card data never touches our servers — use the provider's hosted checkout and hosted payment-method management. Credit the balance only from a verified webhook, idempotently by `providerRef`. Minimum top-up 10 USD. Email a receipt.

---

## 10. Feature specifications

### 10.1 App shell (all dashboard pages)
- Left sidebar, collapsible, with groups: **Main** (Overview, Templates, Send, Contacts, Senders, Compliance), **Development** (Messages, API Keys, Webhooks, Documentation ↗), **Account** (Users, Settings, Billing), **Tools** (Number Lookup, Pricing), **Help** (Email support, Help center).
- Organization switcher at the top of the sidebar. Top bar with breadcrumbs, organization name and the user's role badge, light/dark toggle, user menu.
- Command palette on Ctrl/Cmd+K: jump to any page, start common actions, switch theme.
- Every table: search, filter popover, sortable columns where meaningful, page size 10/25/50/100, "Showing x–y of z", previous/next, skeleton loading rows, a designed empty state with a primary action.
- Every destructive action has a confirmation dialog. Every mutation shows a toast. Forms show inline field errors and disable submit while pending.
- Responsive down to 360 px; keyboard accessible; WCAG AA contrast in both themes.

### 10.2 Overview (`/dashboard`)
- Four cards: **Templates** (create new, view all with count) · **Total contacts** · **Deliverability** (delivered ÷ messages with a final status, for the selected range) · **Balance** (with "Manage" link to billing).
- **Messages panel:** date-range picker (today, 7, 30, 90 days, custom), totals for sent, delivered, failed and spend, and a daily bar chart. A note states how often statistics refresh.
- **Recent contacts** table (short ID, country flag + code + dial prefix, phone, opt-out state) with "View all contacts".
- A persistent banner while business verification is incomplete, linking to Compliance.

### 10.3 Templates
- **List:** card grid with name, category, status badge; search; status and category filters; actions View, Analytics, Duplicate, Delete.
- **Three ways to create:** from scratch, from the sample gallery, from a JSON definition (validated, with a documented schema).
- **Editor:** optional name (auto-generated from the body when blank), category, language, body with undo/redo and an "Add variable" menu. Live footer shows encoding (GSM-7 / Unicode), characters left in the current segment and segment count. Right panel tabs: **Preview** (phone mock-up rendered with sample values), **Checks** (non-GSM characters highlighted, length warnings, missing opt-out wording on marketing templates, unresolved variables), **API** (ready-to-copy cURL, Node and Python snippets for this template).
- **Actions:** Save draft · Submit for review. Review happens in the admin console; `AUTO_APPROVE_TEMPLATES` env enables automatic approval. Only approved templates can be sent.
- **Analytics:** sent, delivered and failed over time for the template.

### 10.4 Send (`/dashboard/send`)
Choose an approved template → fill variables → choose recipient (phone number with country selector, or pick a contact) → choose sender (approved senders for that country) → see encoding, segments and price → Send. The right-hand **Activity** panel shows the live status timeline of messages sent from this page in the session (server-sent events with polling fallback). Until the organization is verified, sending is limited to the verified account phone.

### 10.5 Contacts
Table: ID, country, phone, name, opt-out, created. Search and filters (country, opt-out). **Create contact(s)** dialog with two modes: single form, or CSV upload/paste with column mapping, validation, de-duplication and a downloadable reject report. Row click opens a drawer with details and message history. Delete with confirmation.

### 10.6 Senders (`/dashboard/senders`)
- **Destination countries:** list of enabled countries with the sender in use. **Add country** dialog: pick a country → show dial prefix, price per segment, whether alphanumeric senders are allowed and whether registration is required → pick a sender (platform shared sender or one of the org's approved sender IDs). Sending to a country that is not enabled is rejected — this is a deliberate anti-fraud control.
- **Sender IDs:** request form (value, type, use-case description, intended countries), status badges, review notes from the operator.

### 10.7 Compliance
Tabs: **Business** (verification form; read-only once submitted; status and review note), **Use cases** (what the organization sends, sample messages, how recipients opted in), **Documents** (upload by country and type; private storage; download), **Auto-replies** (table of category, keywords, reply text, status, updated; three protected defaults that can be edited in text but not deleted; add custom keywords).

### 10.8 Messages (`/dashboard/messages`)
Table: short ID (copy), recipient, sender, template, direction, status badge, segments, price, initiated at. Sort by time. Search by number or ID. Filters: status, direction, country, date range, template, API key. CSV export (queued job, emailed link for large exports). Row click opens a drawer: full ID with copy, phone mock-up of the body, status, price, destination country and network, direction, template name and category, error code with explanation, and the full event timeline.

### 10.9 API keys
Organization ID with copy. Table: name, masked key, mode, status, created, last used; actions enable/disable, rename, delete. Creating a key shows the full value **once**. Format `svk_live_…` / `svk_test_…` with at least 32 random bytes; only a SHA-256 hash, prefix and last four characters are stored. Test keys route to `MockProvider` and never charge.

### 10.10 Webhooks
Table: ID, name, endpoint, status, created. **Add webhook** dialog: name, HTTPS URL, event checkboxes with select-all, grouped as Messages (`message.queued`, `.sent`, `.delivered`, `.undelivered`, `.failed`, `.expired`, `.received`), Contacts, Templates, Senders, Billing. Detail page: signing secret (reveal, rotate), delivery log with attempt, response code and duration, **Replay** and **Send test event**.
Delivery follows the Standard Webhooks specification: headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (HMAC-SHA256). Retries with exponential backoff for about 24 hours; an endpoint is disabled after sustained failure and the owners are emailed. Outbound requests have a 10 s timeout, do not follow redirects, and are protected against SSRF (resolve DNS, block private, loopback and link-local ranges, connect to the resolved address).

### 10.11 Users
Table: ID, name, email, role, status, last seen. Invite by email with a role; resend or revoke invitations; change role; remove member. There is always exactly one OWNER; ownership can be transferred; the owner cannot be removed.

| Capability | OWNER | ADMIN | DEVELOPER | BILLING | VIEWER |
|---|---|---|---|---|---|
| View everything | ✓ | ✓ | ✓ | ✓ | ✓ |
| Send messages, manage templates and contacts | ✓ | ✓ | ✓ | – | – |
| API keys and webhooks | ✓ | ✓ | ✓ | – | – |
| Senders and compliance | ✓ | ✓ | – | – | – |
| Billing | ✓ | ✓ | – | ✓ | – |
| Users and settings | ✓ | ✓ | – | – | – |
| Transfer ownership, delete organization | ✓ | – | – | – | – |

Enforce on the server; hide or disable in the UI.

### 10.12 Settings
Tabs: **Business** (legal name, tax ID type, tax ID), **Details** (account phone verified by SMS code, contact phone, timezone), **Profile** (name, change password, two-factor), **Security** (active sessions with revoke).

### 10.13 Billing
Tabs: **Overview** (balance, "Add credit" with preset and custom amounts, auto-recharge card with threshold and amount), **Payment methods** (opens the payment provider's hosted management), **History** (ID, description, status, amount, date; receipt download), **Preferences** (billing email, name, address). Low-balance emails at a configurable threshold.

### 10.14 Tools
- **Number lookup:** country selector + number → validity, E.164 / international / national formats, country and region, number type, time zones. Computed offline with libphonenumber. Rate-limited.
- **Pricing:** **Calculator** (monthly messages, average segments per message, destinations with percentage shares that must total 100 %, live estimated bill with per-destination breakdown, copy button) and **Rates** (searchable table of every country with price per segment, CSV download).

### 10.15 Admin console (`/admin`, platform admins only, separate layout)
Organizations (search, status, balance, suspend/reactivate, manual balance adjustment with mandatory reason) · review queues for business verification, use cases, sender IDs and templates (approve / reject with note, emails the customer) · Providers (create, edit encrypted credentials, health, throughput) · Routes (per country/network: providers, priority, weight, cost) · Rates (CSV import with preview and validation, per-organization overrides) · cross-organization message search · system health (queue depths, receipt lag, provider error rates) · margin report (revenue vs. cost by country and provider) · audit log.

---

## 11. Security requirements

- Passwords: argon2id, minimum 10 characters, checked against a common-password list. Login, signup, reset and OTP endpoints are rate-limited per IP and per account. Responses never reveal whether an email exists.
- Sessions: 256-bit random token, only its hash stored, rotated at login, revocable, 30-day sliding expiry. Cookie-authenticated mutations require a matching `Origin` header and a CSRF token.
- API keys: constant-time comparison of hashes; per-key rate limit (default 50 requests/second, Redis sliding window) with standard rate-limit headers and `429` + `Retry-After`.
- Encrypt at rest with AES-256-GCM using a key from env (with key-version prefix for rotation): provider credentials, webhook secrets, TOTP secrets.
- HTTP headers: HSTS, strict Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, frame denial.
- Logs never contain message bodies, full phone numbers (mask the middle digits), API keys, passwords or tokens.
- Uploads: allow PDF, PNG, JPEG only; 10 MB limit; verify by content sniffing; store outside the web root with random keys; serve only through an authorised endpoint.
- Provider and payment callbacks: verify the signature or shared secret before parsing; reject otherwise.
- Fraud controls: per-organization daily spend cap, stricter limits for new organizations, country allow-list (section 10.6), automatic pause and operator alert when traffic to a single number prefix spikes abnormally.
- Privacy: message bodies are redacted after the organization's retention period; organization data export and deletion are available to the owner; every sensitive action is written to the audit log.
- Add an automated test suite that proves tenant isolation: for every tenant resource, a user of organization A receives 404 for organization B's IDs.

---

## 12. Public API v1

Auth: `x-api-key: <key>` or `Authorization: Bearer <key>`. JSON only. Cursor pagination (`limit`, `cursor`). Errors use RFC 9457 problem details with a stable `code` from section 7.6. All timestamps ISO 8601 UTC.

| Method and path | Purpose |
|---|---|
| `POST /api/v1/messages` | Send one SMS (`to`, `from?`, `text` **or** `template_id` + `variables`, `client_ref?`, `scheduled_at?`). Returns `202` with id, status, segments, price |
| `POST /api/v1/messages/batch` | Up to 1,000 messages; per-item results |
| `GET /api/v1/messages/:id` · `GET /api/v1/messages` | Retrieve / list with filters |
| `GET/POST/PATCH/DELETE /api/v1/contacts[/:id]` | Contacts |
| `GET /api/v1/templates[/:id]` | Templates |
| `GET /api/v1/senders` | Approved sender IDs and enabled countries |
| `GET /api/v1/balance` | Current balance |
| `GET /api/v1/rates` | Price list |
| `POST /api/v1/lookup` | Number lookup |
| `GET/POST/PATCH/DELETE /api/v1/webhooks[/:id]` | Webhook endpoints |

Generate the OpenAPI document from the zod schemas and serve an interactive reference at `/docs` with cURL, Node, Python and PHP examples and a webhook signature verification guide.

---

## 13. Deployment — Hostinger VPS, Ubuntu 24.04

**Prerequisites (ask the owner to confirm):** DNS `A` records for `smsvio.com` ( hostinger VPS ONLY - 179.67.196.35 ) and `www.smsvio.com` pointing to the VPS IP; ports 22, 80 and 443 open in the Hostinger panel firewall; SSH access.

Deliver the following, all in `infra/`:

1. **`scripts/bootstrap.sh`** (idempotent, run once as root): system update; create `deploy` user with sudo and SSH key; disable root login and password authentication; UFW allowing only 22, 80, 443; fail2ban; unattended security upgrades; 2 GB swap file when RAM ≤ 4 GB; timezone UTC; Docker Engine and Compose plugin from Docker's official repository; log rotation for Docker.
2. **`docker-compose.prod.yml`**: services `caddy`, `web`, `api`, `worker`, `postgres`, `redis`, plus a one-shot `migrate` job (`prisma migrate deploy`) that must succeed before `api` and `worker` start. Only Caddy publishes ports. Postgres and Redis are on an internal network with no published ports, with passwords, persistent named volumes, and health checks. Every service has a health check, `restart: unless-stopped`, memory limits and runs as a non-root user. Multi-stage Dockerfiles with small final images.
3. **`Caddyfile`**: automatic HTTPS for `smsvio.com`; `www` → apex redirect; `/api/*` to `api:4000`; everything else to `web:3000`; compression; security headers; request body limit; real client IP forwarded to the apps.
4. **Backups**: nightly `pg_dump` (compressed, encrypted) to a local directory and to S3-compatible storage configured by env, 14-day retention, plus `restore.sh`. Perform and document one successful restore test.
5. **CI/CD**: GitHub Actions — on pull request: lint, typecheck, unit and integration tests, build; on `main`: build and push images to GHCR, then SSH to the VPS, pull, run migrations, `docker compose up -d`, and verify `/readyz`; roll back to the previous image tag automatically if the check fails. Also provide `scripts/deploy.sh` for manual deploys.
6. **Operations**: `/healthz` and `/readyz` (checks Postgres and Redis); graceful shutdown that drains in-flight jobs; an external uptime check recommendation; optional Sentry.
7. **`docs/DEPLOY.md`**: exact, copy-pasteable commands from a fresh VPS to a live site, plus update, rollback, backup-restore, secret-rotation and log-inspection procedures.

**Email note:** use SMTP on port 587 or 465 (port 25 is commonly blocked on VPS providers).

---

## 14. Quality gates (must all pass before a phase is reported complete)

Docker is not installed on this development machine, and localhost is not used. On this machine, run only these gates and fix every failure before reporting a phase:

- `pnpm lint` — zero errors and zero warnings.
- `pnpm typecheck` — zero errors.
- `pnpm test` — unit tests green; `packages/shared` coverage ≥ 95 %; API modules ≥ 80 %.
- `pnpm build` — all apps build.

These three gates run in GitHub Actions on every push to `main` and on every pull request. They must pass there before a phase is complete. The production image and deploy jobs run only on `main`, and only when all three have succeeded. A failure skips the deploy:

- Postgres integration tests (`pnpm test:integration`), including tenant isolation.
- Playwright for every flow delivered so far, in both themes at desktop and mobile widths, with no browser console errors or warnings.
- Fresh-clone Compose smoke test: `cp .env.example .env && docker compose up` gives a working stack with seeded data and one documented demo login.

Phase report written and `docs/` updated.

---

## 15. Build phases

**Phase 0 — Foundation and first deploy.** Monorepo, tooling, env validation, local Docker Compose, CI, health endpoints, placeholder landing page, empty `/signin` page shell, all of section 13.
*Done when:* `https://smsvio.com/` and `https://smsvio.com/signin` load over valid HTTPS from the VPS, `www` redirects, `/readyz` is green, and a push to `main` deploys automatically.

**Phase 1 — Accounts and shell.** Sign-up, email verification, sign-in at `/signin`, password reset, 2FA, sessions, organizations, memberships, invitations, role enforcement, the full app shell (10.1), Users (10.11), Settings (10.12), audit log.
*Done when:* two users in two organizations can work independently and the tenant-isolation test suite passes.

**Phase 2 — SMS library, contacts, templates, lookup.** Section 6 in full, Contacts (10.5), Templates (10.3), Number lookup (10.14).

**Phase 3 — Messaging core.** Countries, networks, providers, routes, rates, `MockProvider`, the whole pipeline (section 7), ledger and balance (9.1–9.2), Senders (10.6), Send (10.4), Messages (10.8), and the admin screens for providers, routes and rates.
*Done when:* a message sent from the dashboard moves through its states live, balance is reserved and charged correctly, and a 100 messages/second, 10-minute load test on the mock provider finishes with no lost or double-charged messages.

**Phase 4 — Developer platform.** API keys (10.9), public API (section 12), `/docs`, webhooks (10.10).

**Phase 5 — Billing and analytics.** Payment provider integration (9.3), Billing (10.13), auto-recharge, low-balance emails, daily statistics aggregation, Overview (10.2), Pricing tools (10.14), template analytics.

**Phase 6 — Compliance and operator console.** Compliance (10.7), opt-out and auto-replies (7.5), the rest of the admin console (10.15), fraud controls.

**Phase 7 — Real carriers.** `SmppProvider` and the owner's chosen HTTP provider(s), inbound messages, delivery-receipt hardening, a staged live test to real handsets in at least three countries.

**Phase 8 — Hardening.** Security review against section 11, dependency audit, backup restore drill, full end-to-end run, performance check on the main tables with one million seeded messages (add indexes or partitioning if any list query exceeds 300 ms), final documentation.

---

## 16. Inputs you must request from the owner (ask at the start of the phase that needs them)

| Needed for | Input |
|---|---|
| Phase 0 | VPS IP and SSH access, GitHub repository, confirmation that DNS points to the VPS |
| Phase 1 | SMTP host, port, user, password and the "from" address; platform admin email |
| Phase 3 | Default price markup over carrier cost; default daily spend cap for new organizations |
| Phase 5 | Payment provider choice and its API keys (must support the owner's country of registration) |
| Phase 7 | Upstream SMS provider(s): SMPP host/port/system ID/password and/or HTTP API credentials, plus their price list |

Never invent these values and never commit them.

---

## 17. Kickoff message (paste this into Cursor)

```
Read docs/SPEC.md completely before doing anything.

Then:
1. Summarise the product, architecture and phase plan back to me in under 300 words so I can confirm you understood it.
2. List every question or missing input you have for Phase 0 (section 16).
3. Wait for my answers.

After I answer, execute Phase 0 only, following every rule in section 1 and every quality gate in section 14. When Phase 0 is complete, give me the phase report and stop. Do not start Phase 1 until I say so.
```

For each later phase send: `Proceed with Phase N from docs/SPEC.md. Ask for any inputs from section 16 first. Stop and report when all quality gates pass.`
