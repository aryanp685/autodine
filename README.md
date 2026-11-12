# AutoDine

**AutoDine is an early-stage, mobile-first QR ordering and restaurant-operations prototype for Indian restaurants.** The current repository includes a polished UI, sample restaurant data, Supabase schema/auth foundations, and a server-side menu reader. It is **not ready to accept real customer orders or payments**.

## Current status

| Area | Status |
|---|---|
| Responsive marketing, menu, cart, dashboard, kitchen and cashier screens | Prototype UI; local/demo interactions only |
| Restaurant signup/sign-in | Supabase Auth actions are present; requires a configured Supabase project |
| Public menu reading | Supabase-backed read path is present, with a demo-data fallback |
| Database schema and row-level security | Initial migrations exist; must be applied and tested against a real Supabase project |
| Order placement and kitchen sync | Implemented in source and covered by local tests; hosted end-to-end order acceptance is not certified. Staging remains NO-GO |
| Guest UPI payment | Not available in the customer flow: no restaurant UPI QR or guest "I have paid" claim is shown. Staff can record a UPI payment they verify outside AutoDine |
| Online payments | Disabled and incomplete: payment schema/functions exist, but the current app has no customer initiation UI or provider verification/webhook route. Do not enable or use provider flows |
| Subscriptions | The seven-day trial is enforced in the database (`restaurant_can_write`). No plan can be bought, and there is no checkout — see `docs/SETUP.md` §6 |
| Production readiness | **NO-GO** until fresh authorized hosted security, recovery, migration, end-to-end, performance, and operator-approval gates are documented. No real payment is an acceptance test |

All restaurant names, orders, dashboard metrics, QR states and payments shown without a configured database are fictional demo content. The displayed 5% tax rate and plan prices are illustrative and must not be treated as tax or billing advice.

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. With no Supabase environment variables, the site runs in demo mode. To configure Supabase, copy `.env.example` to `.env.local`, fill in your own project values, and apply the migrations in `supabase/migrations/`. Never commit `.env.local` or a Supabase secret key. Step by step, and the SQL to check each one: `docs/SETUP.md` (an operator runbook, kept local by `.gitignore` — see the note under Repository layout).

`GET /api/health` returns a limited set of readiness booleans — no keys, ids, rows, or counts. It is not a full migration audit or release-acceptance check; a green response alone does not certify hosted ordering, security, recovery, or pilot readiness.

Before that, `npm run env:check` reads `.env.local` and names what is missing, catches a placeholder left in place, and refuses to pass if a secret key is in a `NEXT_PUBLIC_` variable — the one mistake that would hand every visitor full database access. It prints key prefixes, never values.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run design:check
npm run sql:check
npm test
npm run build
```

The SQL check parses DDL syntax; it does **not** execute migrations or prove that RLS policies/functions are correct. Run migrations and security tests against a disposable Supabase project before relying on them.

## Repository layout

- `app/` — Next.js App Router routes and auth actions
- `components/` — screen components and shared UI
- `lib/` — demo data, money/pricing logic, Supabase clients and database adapters
- `supabase/` — database migrations and fictional seed data
- `app/globals.css` — Tailwind entry, design tokens and the small amount of base CSS
- `styles/premium.css` — the marketing layer only (the product is Tailwind)
- `supabase/checks/` — the SQL to run before and after the trial/plan/UPI migrations
- `/api/health` — booleans only: is this deployment configured, and which migrations are on it?
- `docs/SETUP.md`, `docs/DEMO.md` — the operator's runbook and the demo script. Local
  files, not committed: `.gitignore` keeps internal notes and runbooks out of the
  published repository, and these two contain the SQL that extends a trial by hand.

## Payments

The customer ordering flow places an order as unpaid and directs the guest to
settle at the counter. Staff may record cash, card, or UPI after checking that
payment was actually received. Those records describe an external collection;
AutoDine does not process card details or confirm a bank transfer.

The current customer app does not display the restaurant's UPI QR, accept a
UPI "I have paid" claim, or provide a gateway checkout. The database contains
online-payment schema/functions from earlier work, but the application has no
customer initiation UI or provider verification/webhook route. Treat that
path as unavailable and keep it disabled. Environment keys or a green health
probe do not make it a supported payment flow. Do not use real payments as a
smoke test.

## Privacy and secrets

The repository contains no production credentials. `.env.example` contains blank placeholders only. Keep all real keys in local environment variables or your hosting provider's secret manager; the Supabase secret/service-role key must never use a `NEXT_PUBLIC_` variable.
