# Operator setup checklist

This file is the committed, safe setup guide. It contains no credentials and does not authorize using production as a test database.

## 1. Choose the environment

- For visual development only, use the explicit local demo flag below. Demo data is fictional and must not be represented as a real restaurant or used to place orders.
- For database-backed development or integration testing, use a disposable local/branch Supabase project with synthetic data.
- Production must have valid Supabase public configuration. Production builds fail if it is missing; never enable demo mode on a production deployment.

## 2. Install and configure local development

Use Node.js 22 (the version in `.nvmrc`) and npm:

```bash
npm ci
cp .env.example .env.local
```

For an explicit local visual demo, leave Supabase values blank and run:

```bash
AUTODINE_DEMO_MODE=true npm run dev
```

The demo flag is only honored by `next dev`; it does not authorize a production build or deployment. For real database-backed development, fill in the required values in `.env.local` from a **non-production** Supabase project, then run:

```bash
npm run env:check
npm run dev
```

Required database values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`), kept server-side only

Optional integrations such as menu AI require their own server-only keys and must show an honest unavailable state when absent. Do not configure payment gateway variables: online guest payments and subscription checkout are not available/approved in this build. Customer orders use the approved pay-at-counter flow.

## 3. Production configuration checklist

Before deployment, configure the required Supabase URL and public key in the hosting provider, with the server secret key stored only as a server-side secret. Add `NEXT_PUBLIC_SITE_URL` for the deployed domain and configure `ADMIN_SECRET` only if the protected trial-renewal tool is intentionally used. Review all optional provider keys individually; absent keys must leave those integrations unavailable, not simulate success.

Do not set `AUTODINE_DEMO_MODE` or the GitHub-only `AUTODINE_TEST_DEMO_BUILD` in production. Verify deployment readiness through `/api/health`; it returns fixed readiness fields and no secret values or database rows. A health response is not a substitute for a non-production acceptance run.

## 4. Apply schema changes safely

Apply checked-in migrations in order using the team's approved deployment process. First validate them on disposable/local PostgreSQL or an isolated branch project with synthetic data. `npm run sql:check` checks SQL syntax only; it does not prove runtime behavior, RLS correctness, or parity with a live schema.

Never replay migrations, seed files, integration tests, or destructive checks against production as a test. Production database changes require explicit approval and checked-in forward migrations.

## 5. Automated checks

```bash
npm run typecheck
npm run lint
npm run design:check
npm run sql:check
npm test
npm run build
```

The normal browser workflow is demo-mode UI coverage and is not evidence of real database/auth/provider behavior. For the isolated PostgreSQL/PostgREST browser throttle suite, follow [`e2e-local.md`](e2e-local.md). That runner creates synthetic data in a throwaway local database, runs both browser throttle cases and the existing PostgreSQL throttle regressions, then drops the database. Never point it at production.

For the honest flow-by-flow coverage matrix and remaining non-production integration work, see [`scan-throttle-coverage.md`](scan-throttle-coverage.md) and [`website-readiness-audit.md`](website-readiness-audit.md).

## 6. Locked operational decisions

- Guest ordering is pay at counter; no gateway checkout or payment-method selector.
- Do not implement tax rates, inclusive/exclusive defaults, classifications, exemptions, or place-of-supply rules without written adviser approval. Preserve the current safe behavior and fail closed on invalid/missing tax configuration.
- Preserve RLS, least-privilege grants, server-only secrets, server-side price truth, immutable order/payment snapshots, and idempotency.
- Use browser/OS printing; do not add hardware integrations without approval.
