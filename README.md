# AutoDine

**AutoDine is an early-stage, mobile-first QR ordering and restaurant-operations prototype for Indian restaurants.** The current repository includes a polished UI, sample restaurant data, Supabase schema/auth foundations, and a server-side menu reader. It is **not ready to accept real customer orders or payments**.

## Current status

| Area | Status |
|---|---|
| Marketing, customer menu/cart, dashboard and kitchen | Prototype or preview UI; authenticated cashier actions are an early path and not live-verified |
| Table/QR administration | Live Supabase-backed table, QR issue/revoke and staff-code controls are gated by membership role; hosted Supabase use remains unverified |
| Restaurant signup/sign-in | Supabase Auth actions are present; requires a configured Supabase project |
| Public menu reading | Supabase-backed read path is present, with a demo-data fallback |
| Database schema and row-level security | Migrations 0001–0006 apply in local PGlite tests; migration 0007 schedules Supabase `pg_cron` cleanup and cannot be executed by PGlite. No migration has been applied to a hosted project |
| QR table verification | Printed table QR handles, five-minute venue code, role-gated staff display, hashed 60-minute table sessions, atomic rate limiting and server-only order RPC gate are locally implemented; requires a server-only `QR_VERIFICATION_SECRET` and hosted Supabase verification |
| Guest and counter order flows | Database-side validation, pricing and trial gates are locally tested; customer checkout still does not submit orders or payments, while the authenticated counter UI path is not verified against a live Supabase project |
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

Open <http://localhost:3000>. With no Supabase environment variables, the site runs in demo mode. To configure Supabase, copy `.env.example` to `.env.local`, fill in your own project values, and apply migrations 0001–0007 in order; run `supabase/seed.sql` only after those migrations. The QR verification actions fail closed unless `QR_VERIFICATION_SECRET` is set to a random 32-byte value encoded as 64 hex characters (for example, generate locally with `openssl rand -hex 32`). Keep it server-only; do not commit or send it in chat. No hosted secrets or migrations have been changed from this workspace.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run design:check
npm run sql:check
npm test
npm run build
```

Migration 0006 backfills only active, unexpired, URL-safe legacy QR tokens, preserving their token identifiers in the new table-Qr structure. Excluded legacy row IDs and reasons are written to `public.qr_token_migration_issues` (token text is not copied into the report); inspect that table after a future, separately approved hosted migration. The repository had no live QR-print URL generator, so the new scan route is `/q/<public-token>`; old token IDs remain intact, but an external legacy URL path cannot be confirmed from this checkout.

The SQL check parses DDL syntax only. `npm test` additionally applies migrations 0001–0006 to local PGlite and exercises QR backfill, session binding/revocation, trial/menu/price checks, role permissions and atomic rate limiting. PGlite cannot execute the `pg_cron` schedule in migration 0007; its cleanup function is tested locally and the schedule is checked statically. This is not a substitute for validating all migrations against a disposable Supabase project before relying on them.

## Repository layout

- `app/` — Next.js App Router routes and auth actions
- `components/` — screen components and shared UI
- `lib/` — demo data, money/pricing logic, Supabase clients and database adapters
- `supabase/` — database migrations and fictional seed data
- `styles/design-system.css` — shared product styling and responsive breakpoints

## Privacy and secrets

The repository contains no production credentials. `.env.example` contains blank placeholders only. Keep all real keys in local environment variables or your hosting provider's secret manager; the Supabase secret/service-role key and `QR_VERIFICATION_SECRET` must never use a `NEXT_PUBLIC_` variable. Six-digit venue codes are derived with HMAC and are not stored in the database. Rate limiting stores only a keyed IP fingerprint scoped to a table QR; an hourly-cleanup bound is scheduled every 15 minutes by migration 0007 and deletes records after 23 hours of inactivity, leaving a one-hour scheduler-delay margin under the 24-hour retention target. Raw IPs, entered codes and session bearer tokens are not logged or persisted as plaintext. A guest may still photograph/share a live QR or code; this is not perfect physical-presence detection.
