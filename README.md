# AutoDine

**AutoDine is an early-stage, mobile-first QR ordering and restaurant-operations prototype for Indian restaurants.** The current repository includes a polished UI, sample restaurant data, Supabase schema/auth foundations, and a server-side menu reader. It is **not ready to accept real customer orders or payments**.

## Current status

| Area | Status |
|---|---|
| Marketing, customer menu/cart, dashboard, kitchen and menu/table admin | Prototype or preview UI; authenticated cashier actions are an early path and not live-verified |
| Restaurant signup/sign-in | Supabase Auth actions are present; requires a configured Supabase project |
| Public menu reading | Supabase-backed read path is present, with a demo-data fallback |
| Database schema and row-level security | Migrations 0001–0005 apply and pass local PGlite/RLS tests; still requires a real Supabase project run before use |
| Guest and counter order RPCs | Database-side validation, role checks and trial gating are implemented and locally tested; guest order submission is not connected, while the authenticated counter UI path is wired but not verified against a live Supabase project |
| Counter cash collection | Separate idempotent RPC enforces exact-balance checks and audit records; the authenticated cashier action is wired but not verified against a live Supabase project |
| Online payments, receipts and subscriptions | No payment provider is connected; online verification, subscription billing and persistent receipt UI remain unimplemented |
| Production readiness | Not ready for real restaurant operations or live money |

All restaurant names, orders, dashboard metrics, QR states and payments shown without a configured database are fictional demo content. The displayed 5% tax rate and plan prices are illustrative and must not be treated as tax or billing advice.

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. With no Supabase environment variables, the site runs in demo mode. To configure Supabase, copy `.env.example` to `.env.local`, fill in your own project values, and apply the migrations in `supabase/migrations/`. Never commit `.env.local` or a Supabase secret key.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run design:check
npm run sql:check
npm test
npm run build
```

The SQL check parses DDL syntax only. `npm test` additionally applies all current migrations to a local PGlite PostgreSQL runtime and exercises trial gates, tenant isolation, order pricing, role permissions and cash-payment idempotency. This is not a substitute for validating the migrations against a disposable Supabase project before relying on them.

## Repository layout

- `app/` — Next.js App Router routes and auth actions
- `components/` — screen components and shared UI
- `lib/` — demo data, money/pricing logic, Supabase clients and database adapters
- `supabase/` — database migrations and fictional seed data
- `styles/design-system.css` — shared product styling and responsive breakpoints

## Privacy and secrets

The repository contains no production credentials. `.env.example` contains blank placeholders only. Keep all real keys in local environment variables or your hosting provider's secret manager; the Supabase secret/service-role key must never use a `NEXT_PUBLIC_` variable.
