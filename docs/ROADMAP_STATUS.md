# AutoDine — how much work is left

**Date:** 2026-10-19
**Question answered:** *"tell me how much work is pending now"*

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

### M0 — Engineering foundations · ~2–3 days
*Do this before writing any backend code.*

- ESLint, with rules enforcing the locked design system (no shadows, tokens only, no hard-coded colours)
- A test runner, and the first tests for **money**: tax rounding, totals, discount precedence
- Supabase CLI + the `supabase/migrations/` directory as the single source of truth
- GitHub Actions CI: typecheck → lint → test → build on every push

**Why first:** pricing and trial maths are the two things that are expensive to get wrong and cheap to test. They get tests before they get a database.

### M1 — Data model & tenant isolation · ~5–7 days

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
- **Supabase project** — blocks M1 onward
- **Razorpay account (test mode)** — blocks M5
- **Netlify deploy** — repo is ready; you connect it in ~2 minutes (`docs/DEPLOY_NETLIFY.md`)
- **Domain** — blocks M8 only, and is the only approved spend

**Blocked on someone else:**
- GST/tax treatment for invoices — needs a CA
- Privacy, terms, refund policy — needs a lawyer
- Razorpay **live** activation — needs your business KYC, and my recommendation is that it waits until we're on Supabase Pro

---

## One thing I want to be straight about

The screens you can click through right now are **real, locked, production-intent UI running on mock data.** They are not a product. Orders don't persist, prices are computed in the browser, the QR is decorative, and the trial strip is a hard-coded string.

That's exactly the right state to be in at this point — you approved the design before anyone built the machinery underneath it, which is the expensive-to-reverse decision made cheap. But I don't want the polish of the screens to create a false impression of how close this is to taking a real order.

**The next honest milestone is not "more screens." It's a database with RLS on it and a test that proves one restaurant cannot see another's orders.**
