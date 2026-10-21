# AutoDine

AutoDine is an early-stage QR ordering and restaurant-management application for Indian restaurants. The repository includes a customer menu and cart, table QR sessions, workspace access controls, optional restaurant-configured tax, and an authenticated counter workflow.

## Product scope

- Guests can submit unpaid counter orders from an active table QR when the restaurant is configured for ordering.
- Prices and tax for new orders are recalculated by the server. New restaurants default to no tax; owners may configure a rate for future orders. This is not tax advice—the restaurant owner must verify applicable treatment.
- Online payments, subscription billing, receipts, and the live kitchen board are not connected. Do not use this preview for live restaurant operations or money collection.
- Demo content is fictional and is not saved.

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. Without Supabase settings, the application uses sample data. To connect a development project, copy `.env.example` to `.env.local`, add the values for a project you control, apply the migrations in `supabase/migrations` in order, then run `supabase/seed.sql` only in a disposable development environment.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run design:check
npm run sql:check
npm test
npm run build
```

`npm run sql:check` checks SQL syntax only. The PGlite integration tests exercise database functions and access policies locally; hosted configuration and end-to-end guest ordering still need verification before operational use.

## Security and privacy

Never commit credentials. Use a publishable Supabase key in browser code; keep the Supabase secret/service-role key and `QR_VERIFICATION_SECRET` server-only. An active table QR is a bearer link: anyone with it may start a guest session, so revoke the QR if it is exposed outside the venue. Apply database changes only to projects you are authorized to modify.
