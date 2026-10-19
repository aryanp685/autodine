# AutoDine

**AutoDine is an early-stage, mobile-first QR ordering and restaurant-operations prototype for Indian restaurants.** The current repository includes a polished UI, sample restaurant data, Supabase schema/auth foundations, and a server-side menu reader. It is **not ready to accept real customer orders or payments**.

## Current status

| Area | Status |
|---|---|
| Responsive marketing, menu, cart, dashboard, kitchen and cashier screens | Prototype UI; local/demo interactions only |
| Restaurant signup/sign-in | Supabase Auth actions are present; requires a configured Supabase project |
| Public menu reading | Supabase-backed read path is present, with a demo-data fallback |
| Database schema and row-level security | Initial migrations exist; must be applied and tested against a real Supabase project |
| Order placement and kitchen sync | Not connected to the application yet |
| Online payments, receipts and subscriptions | Not implemented; no payment provider is connected |
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

The SQL check parses DDL syntax; it does **not** execute migrations or prove that RLS policies/functions are correct. Run migrations and security tests against a disposable Supabase project before relying on them.

## Repository layout

- `app/` — Next.js App Router routes and auth actions
- `components/` — screen components and shared UI
- `lib/` — demo data, money/pricing logic, Supabase clients and database adapters
- `supabase/` — database migrations and fictional seed data
- `styles/design-system.css` — shared product styling and responsive breakpoints

## Privacy and secrets

The repository contains no production credentials. `.env.example` contains blank placeholders only. Keep all real keys in local environment variables or your hosting provider's secret manager; the Supabase secret/service-role key must never use a `NEXT_PUBLIC_` variable.
