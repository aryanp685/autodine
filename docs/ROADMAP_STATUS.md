# AutoDine — how much work is left

**Date:** 2026-10-19
**Question answered:** *"tell me how much work is pending now"*

---

## Update — end of day, 2026-10-19

The numbers below have moved since this was first written. Supabase exists
now and the schema is applied, so M1 is partly done rather than not started.
Deploy is live on Vercel. The frontend proportion has not changed: the
screens are still almost entirely on mock data.

| | Then | Now |
|---|---|---|
| M0 foundations | done | done |
| M1 schema + RLS | 0% | **~60%** — schema applied, one migration not yet run |
| Deploy | blocked on you | **live on Vercel** |
| Screens on real data | 0 of 14 | **1 of 13** (`CustomerMenu`) + login/signup auth |

### What was done today

1. **The site was not responsive at all, and nothing said so.**
   `design-system.css` had ~40 responsive rules inside
   `@container frame (max-width: 1000px)`, but `container-name: frame` was
   declared nowhere in the codebase. An undeclared container never matches,
   so the whole responsive layer was dead code. No console error, no build
   warning, no lint failure. Fixed by declaring the container on `[data-app]`.
   Inside the same query, `.dash__nav` was `display: none` on mobile with
   nothing in its place — the dashboard had no navigation on a phone. Added a
   600px phone breakpoint too.
2. **`/dashboard/tables` was 1.1 MB of HTML, 23× the next heaviest page.**
   The QR placeholder drew one `<rect>` per dark cell: ~247 per code, 18
   codes, each serialised as its own React element. It is now one `<path>`
   per code with runs merged — 4,264 elements became 18. 586 KB → 104 KB
   raw, 13.9 KB gzipped. The rendered QR is byte-identical in shape.
3. **Images were 1,168 KB.** Three dish photos were 1536×1024 and render in
   a 104px square — about 7× more pixels than the layout can show. Now 256px
   squares (13–18 KB each). The hero ships three widths behind `srcset`, so a
   phone pulls 33 KB instead of 130 KB. Total 216 KB.
4. **`/states` removed from the public site.** It was a design gallery of
   empty/loading/error/locked states, linked from nothing but the docs, and
   carried nine dead controls. The route is gone; the component stays in the
   repo because it is the only place the post-trial locked layout is designed,
   and that state is a real requirement.
5. **Three inert controls wired.** "Publish menu", "Open kitchen board" and
   "Choose *plan*" were spans styled as buttons with no behaviour. All three
   had destinations that already exist.
6. **Touch targets grown on phones only.** Several controls were 24–32px
   tall. Desktop spacing is untouched.

### What is genuinely finished vs what only looks finished

**Real — backed by the database or by live auth:**

- `CustomerMenu` — reads real restaurants, menus, categories, items, variants
- `LoginScreen` — 100% real, calls `signInAction`
- `SignupScreen` — real `signUpAction` creates a restaurant, menu and
  membership; only the trial copy is a constant
- Money maths (`lib/money.ts`, `lib/pricing.ts`) — integer paise, tested
- The design system, and the ESLint guard that freezes it

**Looks finished, is not — every one of these reads `lib/demo-data.ts`:**

`HomeScreen` · `PricingScreen` · `DashboardScreen` · `MenuEditorScreen` ·
`TablesScreen` · `KitchenScreen` · `CashierScreen` · `CartScreen` ·
`CheckoutScreen`

Nine screens. They render the locked design correctly and they are the
screens a visitor sees most, so the gap is easy to miss.

**Dead controls still on screen** (13, all spans styled as buttons):

- `MenuEditorScreen` (6): Import menu with AI · Add item · Reorder · Bulk
  availability · Save draft · Send for review
- `TablesScreen` (6): Print QR sheet · Add table · Preview · Regenerate ·
  Enable/Disable · Revoke

"Print QR sheet" is deliberately left unwired: there are no `@media print`
rules, so pointing it at `window.print()` would print the whole dashboard
chrome around the sheet.

### The one thing that needs you before anything else moves

**Migration `0002` has not been run on your database.** It is merged, but
until you execute it in the Supabase SQL editor, `menus_public` and
`items_public` are permanently false because migration 0001 has a bug: a
subquery inside an RLS policy is itself filtered by that same table's RLS,
and `restaurants` had no anon policy. The result is silent — the customer
menu shows nothing, with no error anywhere.

Check whether it has run:

```sql
select count(*) from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'restaurant_is_active';
```

`1` = it has run. `0` = it has not.

---

## The short answer

**You are roughly 15–20% of the way to a product a restaurant can pay for.**

What's genuinely finished: the **design**, and a **static frontend shell** that renders it.
What's missing: **essentially all of the product** — data, accounts, security, payments, subscriptions, and the operational plumbing that keeps it alive.

My estimate for the remaining engineering is **45–60 person-days**. Treat that as a planning figure with wide error bars, not a quote: it assumes the locked design holds, and it excludes legal review, tax advice, and the AI menu scanner.

Here's the split, and why it's lopsided.

| | Done | Remaining |
|---|---|---|
| Design & UI/UX | **100%** (locked) | 0 |
| Frontend screens | ~60% (13 screens exist, static + mock data) | wiring every screen to real data, real loading/empty/error states |
| Data model & security | **0%** | all of it |
| Accounts & permissions | **0%** | all of it |
| Ordering & kitchen | **0%** | all of it |
| Payments | **0%** | all of it |
| Subscriptions & trial gating | **0%** | all of it |
| Operations (backups, monitoring) | **0%** | all of it |

The frontend number looks generous and the backend number looks brutal because that's the actual shape of the work. Building thirteen beautiful static screens is the easy part. Everything after that is state, money, concurrency and failure modes.

---

## The milestones

### M0 — Engineering foundations · ✅ **DONE** (2026-10-19)
*Was: do this before writing any backend code.*

- ESLint, with rules enforcing the locked design system (no shadows, tokens only, no hard-coded colours)
- A test runner, and the first tests for **money**: tax rounding, totals, discount precedence
- Supabase CLI + the `supabase/migrations/` directory as the single source of truth
- GitHub Actions CI: typecheck → lint → test → build on every push

**Why first:** pricing and trial maths are the two things that are expensive to get wrong and cheap to test. They get tests before they get a database.

**What shipped:**
- **ESLint** (flat config, `next/core-web-vitals` + `next/typescript`). 0 errors. Three `<img>` warnings left deliberately: the locked screens use plain `<img>` with hand-tuned CSS, and migrating to `next/image` changes rendered markup, so it needs its own verified pass.
- **Vitest, 43 tests** over `lib/money.ts` and `lib/pricing.ts`.
- **Money is now integer paise.** `lib/money.ts` (primitives) and `lib/pricing.ts` (order totals) replaced the floating-point rupee arithmetic that had been written inline in the client components. The cart and checkout now call the tested code — the tests guard the code that actually runs.
- **Verified behaviour-preserving:** the rendered text of `/menu/cart` and `/menu/checkout` is byte-identical to before the refactor (₹776 subtotal / ₹39 tax / ₹815 total).
- **Design-system guard** (`npm run design:check`): fails on drop shadows and on any reintroduced prototype-harness CSS, and freezes hardcoded hex at 97 so new styles must use tokens.
- **Removed 112 lines of dead `.proto-*` CSS** left over from the A/B/C harness.
- **Supabase scaffold** (`supabase/config.toml`, `supabase/migrations/`) — empty until M1.
- **CI** (`.github/workflows/ci.yml`): typecheck → lint → design → test → build on every push.

**Note on the tax model:** the 5% GST in `lib/pricing.ts` is still labelled SAMPLE. Three open questions are written into the file's header comment (tax-inclusive vs exclusive, per-line vs per-order rounding, CGST/SGST vs IGST). That comment must be resolved with a tax adviser before any live transaction.

### M1 — Data model & tenant isolation · ~5–7 days · **~60% DONE**

**Done:** migration `0001` applied — 12 tables, all with `rowsecurity = true`;
seed data (22 items, 21 available, 7 categories, 10 variants); the new-format
Supabase publishable/secret keys wired in; menu read path built and wired to
`CustomerMenu`.

**Not done:** migration `0002` exists but has not been executed against your
database. Without it the public read path is broken (see the box above). Also
missing: tables/QR tokens/orders/payments/subscriptions tables, an
`updated_at` trigger, a rate limit on `place_order`, QR rotation, and an
audit log.

- Full schema: restaurants, users, memberships, menus, categories, items, variants, add-ons, tables, QR tokens, orders, order items, payments, receipts, subscriptions, trial state, audit log
- **Row Level Security on every table** — the security boundary is the database, not the application
- Money as `bigint` paise + currency code; timestamps as `timestamptz` UTC with a per-restaurant IANA zone
- Order snapshots (prices at time of order, not today's prices)
- Seed data so every screen can be exercised

**Why it matters:** get `restaurant_id` scoping or RLS wrong here and every subsequent feature inherits a data-leak bug. This is the one milestone worth being slow on.

### M2 — Accounts & permissions · ~4–5 days

- Owner signup, email verification, login, password reset
- Staff accounts with roles: owner, manager, kitchen, cashier
- Sessions, middleware, and server-side route protection

### M3 — Menu, tables & QR · ~6–8 days

- Menu CRUD with categories, variants, add-ons, and a draft → review → publish flow
- Image upload with server-side WebP compression (the 1 GB storage budget depends on it)
- Table CRUD, and **rotating short-lived QR tokens validated server-side** — because a static QR cannot prove a guest is in the room
- Revoke / regenerate / print sheets

### M4 — Ordering & kitchen · ~8–10 days

- Customer ordering against real data, with **all pricing computed server-side** from current menu prices
- Order placement with idempotency enforced by unique database indexes
- **Two separate state machines**: preparation state and payment state, never conflated
- Kitchen board over Supabase Realtime, with full reconciliation on reconnect so **an order is never lost**
- Voice announcements

### M5 — Payments & receipts · ~6–8 days

- Razorpay in **test mode**: order creation, checkout, signature verification
- **Webhook handling with signature verification and idempotency** — payment status is decided by the webhook, never by the browser's success callback
- Counter payments (cash / card on device)
- GST-compliant invoices — **needs a CA to confirm the tax treatment before this ships**

### M6 — Subscriptions, trial & gating · ~6–8 days

- **10-day trial enforced server-side** from server timestamps
- Plan gating at ₹899 / ₹1,599 / ₹2,699, with usage limits
- Post-trial: read-only, new orders blocked, **nothing deleted**
- Razorpay Subscriptions / UPI AutoPay with dunning
- Billing screens, invoices, plan changes, cancellation

### M7 — Operations · ~3–4 days

- GitHub Actions cron: daily keep-awake ping (beats Supabase's 7-day inactivity pause) and nightly `pg_dump`
- **A restore drill.** An untested backup is not a backup
- Error monitoring, structured logs, rate limiting

### M8 — Launch readiness · ~4–6 days

- Domain + DNS (the only spend you've approved)
- Legal pages: privacy, terms, refunds & cancellation — **lawyer-reviewed, not written by me**
- DPDP Act review (substantive compliance due 13 May 2027)
- Security pass: RLS audit, webhook replay tests, tenant-isolation tests
- **Pilot with one restaurant on test payments**

### Later, not on the critical path

- **AI menu scanner** — client-side OCR, mandatory owner review, and **no accuracy claim until it's been measured** on real menus
- Branding / white-label per restaurant
- Reports & analytics, multi-language, international expansion

---

## The critical path

```
M0 foundations ──▶ M1 schema + RLS ──▶ M2 auth ──▶ M3 menu/QR ──▶ M4 ordering/kitchen ──▶ M5 payments ──▶ M6 subscriptions ──▶ M8 launch
                                                                                                              ▲
                                                                                          M7 operations ──────┘
```

M1 and M2 are the true blockers — nothing else can be built safely without them. M5 and M6 can partially run in parallel once M4 lands. M7 is small but gates going live with real money.

**Realistic sequence if we go flat out:** foundations and schema first, then auth, then the ordering path end-to-end (M3→M4→M5) because that's the part a restaurant actually feels, then subscriptions, then launch.

---

## What I can start immediately, and what's blocked on you

**I can start now, no waiting:**
- M0 in full — linting, tests, CI, migrations scaffold. None of it needs an account.

**Blocked on you (I won't create accounts in your name):**

- **Run migration `0002` in the Supabase SQL editor** — blocks *everything*
  downstream. Nothing else can be verified until the public read path works.
  This is the single highest-value 30 seconds you can spend today.
- **Confirm the Supabase region is Mumbai (`ap-south-1`)** — still
  unconfirmed. Singapore measured ~58 ms against Mumbai's ~5 ms.
- **Razorpay account (test mode)** — blocks M5
- **Domain** — blocks M8 only, and is the only approved spend

**Done, no longer blocked:**

- Supabase project — created (ref `jubagjlnmbntogeyjiwt`, plan Free)
- Deploy — live on Vercel. Two things had to be fixed to get there: the
  Vercel Framework Preset was `Other` (set at import time when the repo held
  only a README, and never re-detected), and one build served a stale cache.
  Vercel's Hobby plan forbids commercial use, so this needs a decision before
  a paying restaurant goes live — Netlify Free is the ₹0 ToS-safe fallback.

**Blocked on someone else:**
- GST/tax treatment for invoices — needs a CA
- Privacy, terms, refund policy — needs a lawyer
- Razorpay **live** activation — needs your business KYC, and my recommendation is that it waits until we're on Supabase Pro

---

## One thing I want to be straight about

The screens you can click through right now are **real, locked, production-intent UI running on mock data.** They are not a product. Orders don't persist, prices are computed in the browser, the QR is decorative, and the trial strip is a hard-coded string.

That's exactly the right state to be in at this point — you approved the design before anyone built the machinery underneath it, which is the expensive-to-reverse decision made cheap. But I don't want the polish of the screens to create a false impression of how close this is to taking a real order.

**The next honest milestone is not "more screens." It's a database with RLS on it and a test that proves one restaurant cannot see another's orders.**
