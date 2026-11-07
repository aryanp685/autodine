# AutoDine

AutoDine is a mobile-first QR ordering and restaurant-operations application for Indian restaurants. It includes guest ordering, owner/staff operations, kitchen and cashier screens, bills/invoices, and database-backed menu and session flows.

## Current capability and limits

- Customer ordering is **pay at the counter**. AutoDine does not offer a guest online-payment gateway or subscription checkout. Staff record counter settlement through the authorized flow.
- GST behavior must follow adviser-approved rules. The current code supports only its explicitly configured rate path; it does not implement a complete tax-policy model for every jurisdiction, inclusive price, item classification, exemption, or place of supply. Do not treat sample values as tax advice or extend the model by guessing.
- Local and automated UI tests may use fictional sample data only when a developer explicitly opts into demo mode. A production build without the required Supabase URL and public key fails rather than serving sample restaurant data.
- `/demo/menu`, where enabled, is a clearly identified, read-only sample. It is not a real restaurant, order path, or database-backed flow.
- Passing unit or demo-mode browser tests does not prove that production credentials, email delivery, AI providers, or a specific restaurant's configuration work. The current readiness assessment and remaining integration coverage are in [`docs/website-readiness-audit.md`](docs/website-readiness-audit.md).

## Local development

Requirements: Node.js 22 and npm.

```bash
npm ci
```

Choose one mode:

1. **Explicit local visual demo** (fictional data, no writes):

   ```bash
   AUTODINE_DEMO_MODE=true npm run dev
   ```

2. **Database-backed development:** copy `.env.example` to `.env.local`, enter credentials for a local or non-production Supabase project, run `npm run env:check`, then start `npm run dev`. Keep `.env.local` private and never use production data for integration tests.

The demo flag is for local development only. Never set `AUTODINE_TEST_DEMO_BUILD` in a deployment; it is an explicit GitHub Actions-only flag for hermetic UI tests. Production requires Supabase configuration and does not fall back to fictional data.

## Database-backed browser test

The throttle integration suite uses a disposable local PostgreSQL database and local PostgREST, not production. Follow [`docs/e2e-local.md`](docs/e2e-local.md). It runs both real-browser throttle cases and the existing PostgreSQL throttle regressions, retaining evidence as CI artifacts.

For what is covered and what still needs a non-production integration environment, see [`docs/scan-throttle-coverage.md`](docs/scan-throttle-coverage.md) and the [`website readiness audit`](docs/website-readiness-audit.md).

## Quality checks

```bash
npm run typecheck
npm run lint
npm run design:check
npm run sql:check
npm test
npm run build
```

`npm run sql:check` parses migration syntax; it does not execute every RLS policy or prove production-schema parity. Run database and browser integration tests only against disposable local or approved non-production services.

## Configuration and security

See [`docs/SETUP.md`](docs/SETUP.md) for the tracked operator setup checklist. `GET /api/health` returns a no-store readiness response with fixed status fields; it never returns keys, restaurant names, or rows. `npm run env:check` identifies missing or malformed required environment values and never prints full key values.

Never commit real credentials, `.env.local`, production data, or secret/service-role keys in `NEXT_PUBLIC_*` variables. The server-side Supabase secret key bypasses RLS and must remain server-only.
