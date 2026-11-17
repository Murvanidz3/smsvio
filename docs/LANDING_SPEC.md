# SMSVIO — Front Page (Marketing Site) Spec

> **Owner:** save this file in the project as `docs/LANDING_SPEC.md`. Send the kickoff message from section 12 in a **new** Cursor chat, at a moment when no other chat is working on the repository, because both push to `main`.

---

## 1. Goal

Replace the placeholder at `https://smsvio.com/` with a light, refined, elegant marketing site that makes a business want to sign up and send SMS worldwide with SMSVIO.

The feeling: **calm, precise, premium, trustworthy.** Think of a well-designed print magazine crossed with a modern developer tool: lots of air, beautiful typography, few colours used with intent, and small moments of delight. It must not look like a generic SaaS template.

SMS only. Never mention WhatsApp, RCS, MMS, voice or email as products.

---

## 2. Rules (in addition to section 1 of `docs/SPEC.md`)

1. **Nothing fake.** No invented customers, logos, testimonials, ratings, awards, "trusted by" strips, user counts, uptime or delivery percentages. Any number shown must come from real data (for example the count of supported countries comes from the database) or from a documented product rule (for example "top up from 10 USD"). If a section would need a claim we cannot back, leave the section out.
2. **Link only to pages that exist.** If `/docs` is not live yet, do not show a link to it.
3. **Do not touch the dashboard.** The marketing site lives in its own route group (`apps/web/app/(marketing)/`) with its own layout, its own light theme and no imports from the dashboard shell. Dashboard routes, styles and tests must be unchanged.
4. **Original work.** Our own wording, illustrations and icons. No stock photos, no copied text or layouts from other messaging companies.
5. Ask for the inputs in section 11 before you need them. Never invent a company address, legal text or contact email.

---

## 3. Pages

| Path                                                | Content                                                                                                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                 | The landing page (section 6)                                                                                                                                                                               |
| `/pricing`                                          | Full public rate table: search by country or dial code, price per segment, sender type allowed, registration required, CSV download, and the pricing calculator from the dashboard reused in a public form |
| `/terms`, `/privacy`, `/acceptable-use`, `/cookies` | Legal pages rendered from MDX files the owner supplies (section 11)                                                                                                                                        |
| `/404`                                              | A designed not-found page in the same style                                                                                                                                                                |

The header "Sign in" button goes to `/signin`; "Get started" goes to `/signup`. Signed-in visitors see "Open dashboard" instead of both.

---

## 4. Visual design system

Define every value below as a design token (CSS variables + Tailwind theme) in the marketing route group only.

### Colour (light only)

| Token             | Value                                                                                                      | Use                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--bg`            | `#FAF9F6`                                                                                                  | Page background (warm ivory, not pure white)                                                                   |
| `--surface`       | `#FFFFFF`                                                                                                  | Cards, phone screen, code panels                                                                               |
| `--surface-muted` | `#F3F1EC`                                                                                                  | Alternate section bands                                                                                        |
| `--line`          | `#E8E5DE`                                                                                                  | Hairline borders (1px)                                                                                         |
| `--ink`           | `#111827`                                                                                                  | Headings and primary text                                                                                      |
| `--ink-2`         | `#4B5563`                                                                                                  | Body text                                                                                                      |
| `--ink-3`         | `#8A8F98`                                                                                                  | Captions, labels                                                                                               |
| `--brand`         | match the teal of the existing SMSVIO logo exactly (read it from the logo file); if no file, use `#0F8C7A` | Primary buttons, links, key highlights                                                                         |
| `--brand-ink`     | brand darkened ~20 %                                                                                       | Button hover, text on brand tints                                                                              |
| `--brand-tint`    | brand at ~8 % on `--bg`                                                                                    | Soft badges, highlighted rows                                                                                  |
| `--accent`        | `#F2A97E` (soft apricot)                                                                                   | Very sparing warm counterpoint: one gradient glow, a status dot, a hand-drawn underline. Never a button colour |
| `--success`       | `#2E9E6B`                                                                                                  | "Delivered" state in demos                                                                                     |

All text must meet WCAG AA contrast against its background. Check `--ink-3` especially.

### Typography

- **Display:** _Instrument Serif_ (regular and italic) for h1–h2 and large numbers. Use the italic for one or two emphasised words per headline, not more.
- **Text/UI:** _Geist_ (400, 500, 600).
- **Code:** _Geist Mono_.
- Load with `next/font`, self-hosted, `display: swap`, subsets limited to what is used.
- Scale (desktop / mobile): h1 72/44 px, line-height 1.05, letter-spacing −0.02em · h2 48/34 · h3 22/20 · body 18/16, line-height 1.6 · small 14.
- Body text max width 62ch. Headlines max 14 words.

### Space, shape, depth

- 8 px grid. Content width 1200 px with 24 px gutters (16 px on mobile). Section padding 128 px desktop / 80 px mobile.
- Radius: 12 px controls, 20 px cards, 40 px phone mock-up.
- Borders do most of the work; shadows are rare and soft (`0 1px 2px rgba(17,24,39,.04), 0 12px 32px -12px rgba(17,24,39,.10)`).
- Hero background: two very soft radial glows (brand tint top-left, accent tint bottom-right) plus a barely visible fine dot grid. Never saturated.

### Motion

- Subtle and purposeful: elements fade and rise 12 px on first scroll into view, 400 ms, ease-out, 60 ms stagger.
- The phone demo animates messages arriving and status ticks changing (queued → sent → delivered).
- Buttons: 150 ms colour and 1 px lift on hover; visible focus ring in brand colour.
- Respect `prefers-reduced-motion`: no movement, only instant state.
- Use CSS and a small library only if needed; no heavy animation or 3D libraries.

### Avoid

Purple/blue gradients, glassmorphism everywhere, 3D blobs, emoji used as icons, stock photos of people with headsets, fake dashboards with lorem ipsum, every section centred, more than one accent colour per section, walls of feature cards with identical icons.

### Icons and illustration

lucide-react icons at 1.5 px stroke, in `--ink` or `--brand`. Illustrations are built in code (SVG/HTML): the phone mock-up, a world map of dots, message bubbles, delivery ticks. Keep them in the same line-and-tint style.

---

## 5. Brand voice

Clear, confident, quiet. Short sentences. Speak to the person who has to make SMS work: developers, product teams, operations. Concrete over clever: say what happens ("You see every message's status in real time") rather than slogans ("Supercharge engagement"). No exclamation marks, no superlatives we cannot prove.

---

## 6. Landing page structure (`/`)

**1. Header** (sticky, 72 px, `--bg` with blur and a hairline once scrolled): logo · Product · Pricing · Coverage · Developers (anchor links on `/`) · "Sign in" (text button) · "Get started" (brand button). Mobile: logo + menu button opening a full-screen sheet.

**2. Hero** — two columns on desktop, stacked on mobile.

- Left: small eyebrow ("SMS for every country"), h1 such as _"Send SMS anywhere. **See** every delivery."_ (final copy is yours, within section 5), a two-line subhead about global reach, a simple API and transparent per-message pricing, then "Get started" and "See pricing". Below, a single line of plain facts: `{N} countries · Pay as you go · No monthly fee` with N from the database.
- Right: the **interactive phone demo**. A phone mock-up with a composer underneath: country picker and a text field. As the visitor types, show live: encoding (GSM-7 / Unicode), characters left in the segment, number of segments, and price for the chosen country. Use the real encoding and segment functions from `packages/shared` and real prices from the public rates endpoint (section 8). Pre-fill a friendly example (an order-ready notice). A "Preview delivery" button animates the bubble into the phone with status ticks. No message is actually sent.

**3. Value strip** — three short statements in a row with hairline dividers: _Global reach_ (route to {N} countries) · _Live delivery status_ · _Fair, visible pricing_.

**4. Product** — an alternating layout (text left, visual right, then reversed), four blocks, each with a code-built visual:

- _Send from the dashboard or the API_ — composer and template with variables.
- _Know what happened to every message_ — a message row opening into a timeline (queued → sent → delivered) with an error explanation example.
- _Templates that count for you_ — the segment counter highlighting a character that forces Unicode.
- _Built-in compliance_ — opt-out keywords (STOP / START / HELP) with auto-replies, sender ID approval, per-country rules.

**5. How it works** — three numbered steps on one line: Create your account · Add a country and top up · Send your first message. Large serif numerals.

**6. Developers** — split section: left a short paragraph (REST API, API keys, signed webhooks, idempotency); right a code panel with tabs cURL / Node / Python / PHP showing `POST /api/v1/messages` exactly as defined in section 12 of `docs/SPEC.md`, copy button, syntax highlighting rendered at build time. A second small panel shows a webhook payload for `message.delivered`. Link to `/docs` only if it exists.

**7. Coverage** — a dotted world map built in SVG, with supported countries tinted. Beside it a search box: type a country, see price per segment, whether alphanumeric senders are allowed and whether registration is required. "See all rates" → `/pricing`.

**8. Pricing** — one elegant card, not a three-tier table: "Pay only for what you send." Bullet facts from product rules: no subscription, no setup fee, top up from 10 USD, price per segment by country, unused balance stays in your account. A small "estimate your bill" calculator (messages per month + destination) and "See all rates".

**9. FAQ** — accordion, 6–8 questions answered truthfully from `docs/SPEC.md`: what a segment is and why Unicode costs more, which countries, how pricing and top-ups work, sender IDs and registration, delivery reports, API and webhooks, opt-out handling, how to get started.

**10. Final call to action** — a full-width band on `--surface-muted`: serif headline, one line of text, "Get started" and "Sign in".

**11. Footer** — logo and one-line description; columns Product (Pricing, Coverage, Developers), Company (Contact), Legal (Terms, Privacy, Acceptable use, Cookies); copyright with the legal company name. Only links that exist.

---

## 7. Responsiveness and accessibility

- Designed at 1440, 1024, 768, 390 and 360 px; nothing overflows horizontally.
- Phone demo usable on mobile (composer above the phone or collapsible).
- Semantic landmarks, one h1, logical heading order, skip link, full keyboard use, visible focus, labels on every input, `aria-live` for the live counter, alt text on meaningful visuals and `aria-hidden` on decorative ones.

---

## 8. Data the page needs

Add a **public, unauthenticated, read-only** endpoint `GET /api/public/rates` returning, per enabled country: ISO code, name, dial code, customer price per segment, alpha sender allowed, registration required — and the country count. Never expose provider names, costs, routes or margins. Cache it (HTTP cache headers + revalidation every 10 minutes), rate-limit by IP, and cover it with tests that prove no cost or provider data leaks.

The landing and `/pricing` pages render on the server with this data (static generation with revalidation), so they are fast and indexable. If the endpoint fails, the page still renders: price elements show "See pricing" instead of a number.

---

## 9. SEO and sharing

Per-page `title` and `description`; canonical URLs on `https://smsvio.com`; Open Graph and Twitter cards with a generated OG image in the site style; `sitemap.xml` and `robots.txt` (allow marketing pages, disallow `/dashboard`, `/admin`, `/api`); JSON-LD `Organization` and `WebSite`; favicon set and web manifest from the logo.

---

## 10. Quality gates for this work

- All existing gates in section 14 of `docs/SPEC.md` still pass; dashboard tests unchanged and green.
- Lighthouse CI on `/` and `/pricing`, mobile profile: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95. LCP < 2.5 s, CLS < 0.05.
- Playwright: header links, mobile menu, phone demo counter (GSM-7 160 → Unicode 70 when a Georgian letter is typed), country search, FAQ accordion, CTA targets, 404 page, reduced-motion mode.
- **Screenshots for review:** CI saves full-page screenshots of `/` and `/pricing` at 1440, 768 and 390 px as an artifact. After deploy, download them and list them in the report so the owner can review the design.
- No console errors or warnings; no horizontal scroll at any tested width.

---

## 11. Inputs to request from the owner before you need them

- Legal company name and registered address for the footer and legal pages.
- The legal texts (Terms, Privacy, Acceptable use, Cookies) or approval to draft them as clearly labelled drafts for the owner to review before they are published.
- A public contact method (email address or contact form destination). Email sending is disabled, so a contact form needs a decision.
- Social media links, if any.
- Confirmation that per-country prices may be shown publicly.

---

## 12. Kickoff message (paste into a new Cursor chat)

```
You are continuing an existing project. You have no memory of earlier chats, so first:

1. Read docs/SPEC.md and docs/LANDING_SPEC.md completely. LANDING_SPEC.md defines this task; SPEC.md's rules in section 1 still apply.
2. Read docs/DECISIONS.md, README.md and the reports in docs/reports/, and inspect the codebase and git log.
3. Run the local quality gates (lint, typecheck, unit tests, build) and report the result.

Then:
- Summarise in under 200 words how you will build the marketing site and where it will live in the codebase.
- List the inputs you need from section 11 of LANDING_SPEC.md.
- Wait for my answers.

After I answer, build it in two steps and stop after each:
Step 1 — design tokens, header, hero with the working phone demo, footer, and the public rates endpoint. Commit, push, wait for a fully green CI run including the deploy, download the review screenshots, and stop so I can review the look on https://smsvio.com.
Step 2 — after my approval or changes: every remaining section, /pricing, legal pages, 404, SEO, Lighthouse CI. Commit, push, wait for green including the deploy, write docs/reports/landing.md, and stop.

If Playwright or Lighthouse fails, read the failure with `gh run view <id> --log-failed` before changing code. Never weaken or skip a test to get a green run.
```
