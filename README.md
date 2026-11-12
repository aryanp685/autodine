# AutoDine

AutoDine is a mobile-first QR ordering and restaurant-operations application for Indian restaurants. It includes guest ordering, owner/staff operations, kitchen and cashier screens, bills/invoices, and database-backed menu and session flows.

## Current capability and limits

- Customer ordering is **pay at the counter**. Staff record cash, card, or UPI only after verifying that the restaurant received it. Guests cannot claim an online payment or use a gateway checkout; keep online guest payments disabled.
- Subscription plans use one account-level subscription shared across its outlets. The approved monthly prices are Starter ₹999 (1 outlet), Professional ₹2,699 (5 outlets), and Business ₹3,699 (unlimited); the trial is 21 days. Subscription screens and database records are implemented, but no payment provider is approved or configured, so provider-dependent checkout and charges fail closed.
- GST behavior must follow adviser-approved rules. The current code supports only its explicitly configured rate path; it does not implement a complete tax-policy model for every jurisdiction, inclusive price, item classification, exemption, or place of supply. Do not treat sample values as tax advice or extend the model by guessing.
- Local and automated UI tests may use fictional sample data only when a developer explicitly opts into demo mode. A production build without the required Supabase URL and public key fails rather than serving sample restaurant data.
- `/demo/menu`, where enabled, is a clearly identified, read-only sample. It is not a real restaurant, order path, or database-backed flow.
- Passing unit or demo-mode browser tests does not prove that production credentials, email delivery, AI providers, or a specific restaurant's configuration work. See [`docs/website-readiness-audit.md`](docs/website-readiness-audit.md) and `RELEASE-BLOCKER-REPORT.md` for the dated readiness evidence and open gates. Production readiness remains **NO-GO** until fresh, authorized acceptance evidence is recorded.

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

2. **Database-backed development:** copy `.env.example` to `.env.local`, enter credentials for a local or non-production Supabase project, run `npm run env:check`, then start `npm run dev`. Keep `.env.local` private and never use Production data for integration tests. Preview/Development builds refuse to use a configured Production Supabase project; see [`docs/preview-isolation.md`](docs/preview-isolation.md).

The demo flag is for local development only. Never set `AUTODINE_TEST_DEMO_BUILD` in a deployment; it is an explicit GitHub Actions-only flag for hermetic UI tests. Production requires Supabase configuration and does not fall back to fictional data.

See [`docs/SETUP.md`](docs/SETUP.md) for the tracked setup checklist.

## Tests and quality checks

```bash
npm run typecheck
npm run lint
npm run design:check
npm run sql:check
npm test
npm run build
```

`npm run sql:check` parses migration syntax; it does not execute every RLS policy or prove Production-schema parity. Database integration and browser tests must use disposable local services and synthetic data. The isolated throttle and full-stack browser-test setup is documented in [`docs/e2e-local.md`](docs/e2e-local.md); skipped cases are not verified.

## Configuration, health, and security

`GET /api/health` returns fixed readiness fields without keys, restaurant names, or rows. It is not a full migration audit or release-acceptance check; a green response alone does not certify hosted ordering, security, recovery, or pilot readiness. `npm run env:check` identifies missing or malformed required environment values and never prints full key values.

Never commit real credentials, `.env.local`, Production data, or secret/service-role keys in `NEXT_PUBLIC_*` variables. The server-side Supabase secret key bypasses RLS and must remain server-only.
