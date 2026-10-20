# AutoDine

**AutoDine is an early-stage, mobile-first QR ordering and restaurant-operations prototype for Indian restaurants.** The current repository includes a polished UI, sample restaurant data, Supabase schema/auth foundations, and a server-side menu reader. QR guest orders can be submitted as unpaid counter orders after table verification in a configured test/preview environment; this is not ready for production operations or payments.

## Current status

| Area | Status |
|---|---|
| Marketing, customer menu/cart, dashboard and kitchen | Prototype or preview UI; authenticated cashier actions are an early path and not live-verified |
| Table/QR administration | Live Supabase-backed table and QR issue/revoke controls are gated by membership role; guest ordering is QR-only and hosted Supabase use remains unverified |
| Restaurant signup/sign-in | Supabase Auth actions are present; requires a configured Supabase project |
| Public menu reading | Supabase-backed read path is present, with a demo-data fallback |
| Database schema and row-level security | Core migrations and order RPCs are exercised in local PGlite; cleanup migration 0007 requires Supabase `pg_cron`. Guest-order migrations 0010–0011 and optional owner tax-settings migration 0012 are applied to the user-approved test project only; production is unchanged |
| QR table ordering | Printed, revocable table QR handles start hashed 60-minute guest sessions; rate-limited, server-only order RPC gate and guest menu flow are locally implemented. Anyone with an active QR can order, so revoke a QR if it is shared outside the venue. Requires a server-only `QR_VERIFICATION_SECRET` and hosted Supabase verification |
| Guest and counter order flows | QR guest checkout creates unpaid counter orders through the server-only, idempotent RPC. A full hosted UI-to-kitchen test is still pending; online payment is paused and not connected |
| Optional restaurant tax | New restaurants default to 0%; owners can configure 0–30% (up to two decimals) or turn GST off. Cart and checkout follow the restaurant setting, and the database recomputes new orders. Existing settings and historical totals are preserved; owners must verify their applicable tax treatment |
| Counter cash collection | Separate idempotent RPC enforces exact-balance checks and audit records; the authenticated cashier action is wired but not verified against a live Supabase project |
| Online payments, receipts and subscriptions | No payment provider is connected; online verification, subscription billing and persistent receipt UI remain unimplemented |
| Production readiness | Not ready for real restaurant operations or live money |

All restaurant names, orders, dashboard metrics, QR states and payments shown without a configured database are fictional demo content. Demo mode adds no tax by default. The tax setting is a billing control, not tax advice; each owner must verify the restaurant's applicable GST treatment before live billing. Plan prices are illustrative.

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. With no Supabase environment variables, the site runs in demo mode. To configure Supabase, copy `.env.example` to `.env.local`, fill in your own project values, and apply all migrations in order; run `supabase/seed.sql` only after those migrations. QR guest-session creation fails closed unless `QR_VERIFICATION_SECRET` is set to a random 32-byte value encoded as 64 hex characters (for example, generate locally with `openssl rand -hex 32`). It is used only to key privacy-preserving IP rate-limit fingerprints; keep it server-only and do not commit or send it in chat.

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

The SQL check parses DDL syntax only. `npm test` applies migrations to local PGlite and exercises QR backfill, session binding/revocation, order pricing, role permissions, the owner-only tax-setting RPC and atomic rate limiting. PGlite cannot execute the `pg_cron` schedule in migration 0007; its cleanup function is tested locally and the schedule is checked statically. The optional tax migration was also applied and verified on the approved test Supabase project; no production Supabase project was changed.

## Repository layout

- `app/` — Next.js App Router routes and auth actions
- `components/` — screen components and shared UI
- `lib/` — demo data, money/pricing logic, Supabase clients and database adapters
- `supabase/` — database migrations and fictional seed data
- `styles/design-system.css` — shared product styling and responsive breakpoints

## Privacy and secrets

The repository contains no production credentials. `.env.example` contains blank placeholders only. Keep all real keys in local environment variables or your hosting provider's secret manager; the Supabase secret/service-role key and `QR_VERIFICATION_SECRET` must never use a `NEXT_PUBLIC_` variable. Rate limiting stores only a keyed IP fingerprint scoped to a table QR; an hourly-cleanup bound is scheduled every 15 minutes by migration 0007 and deletes records after 23 hours of inactivity, leaving a one-hour scheduler-delay margin under the 24-hour retention target. Raw IPs and session bearer tokens are not logged or persisted as plaintext. A guest may photograph or share an active QR; anyone with the link can order until it is revoked.
