# AutoDine — authoritative project instructions

These rules apply to every coding agent, developer task, test, and deployment in this repository. Read this file before changing code. For a specific subsystem, follow its linked specification too. If sources appear to conflict, stop and ask rather than weakening a locked decision; current explicit user direction may clarify scope but does not silently rewrite unrelated decisions.

## Approval and scope

- Preserve existing working behavior. Do not alter approved product specifications, financial behavior, database semantics, security controls, or deployment targets without explicit user approval.
- Phase 2+ product implementation requires explicit user approval. Approval is limited to the requested scope; it is not blanket approval to invent additional product behavior. The approved P2–P10 roadmap is already complete per the audit record; do not reopen it or invent new roadmap scope without explicit approval.
- Ask before consequential production database, financial, security, or destructive changes. Apply database changes through checked-in forward migrations and verify them without using production for integration tests.
- GST treatment is locked as described below. Do not implement tax-policy changes while approval is outstanding.

## Permanent GST constraint

- GST rules and rates may come only from explicitly approved configuration.
- Never invent GST rates, defaults, classifications, inclusive/exclusive treatment, exemptions, or place-of-supply rules.
- GST calculations must follow a formally approved tax policy; do not infer policy from sample/demo values or existing implementation.
- Until approval, GST-dependent functionality must remain safely gated and fail closed. Preserve existing safe behavior; do not make a tax calculation appear compliant by guessing.

## Approved product and money decisions

- Money is integer paise (`BIGINT` in SQL); never use floating-point money. The database is the source of truth for order pricing; clients do not submit trusted totals.
- Preserve immutable order/item/payment snapshots and idempotency guarantees. Do not rewrite historical financial records as part of unrelated work.
- Customer ordering is **pay at counter only**. Do not turn on a payment gateway in guest checkout or add a payment-mode selector. Staff settlement remains the simple authorized “mark paid” action; “served” and “paid” are separate states.
- One table has one open sitting/session; later guest submissions create separate tickets containing only the newly submitted items. Preserve the session link, guest-token idempotency, and payment ledger rather than merging or duplicating tickets.
- Invoice, checkout, and printing behavior must follow the approved Invoice Spec v1.0 and the already-implemented flows. Browser/OS printing is the supported printing model; do not add printer hardware integrations without approval. Kitchen tickets remain screen-first; do not reintroduce KOT print without approval.
- Kitchen announcements must retain the approved content in this order: order number, table, items, quantities, and guest note. Preserve deduplication and persistence. Call Waiter copy is `टेबल X, वेटर ध्यान दीजिए。` unless the user explicitly changes it.
- For QR/session throttling, follow `docs/scan-limit-l1.md`: throttle verification/session minting only, never order submission; a refused scan does not create a session or order. Keep the race/idempotency guarantees covered by the database tests.

## Security and operational invariants

- Never commit secrets, production credentials, `.env.local`, or test data copied from production. Secret/service-role keys must never be exposed through `NEXT_PUBLIC_*` variables.
- Preserve RLS, least-privilege grants, token-scoped guest reads, fixed `search_path` on security-definer functions, safe redirects, CSP protections, and server-side authorization. Do not “fix” a failing test by bypassing these controls.
- Never run integration, browser, load, or destructive tests against production services or production data. Use disposable local PostgreSQL / local Supabase-compatible services and synthetic seed data only. C4 is proven with the isolated local PostgreSQL harness; it must not be replayed against production.
- For the database-backed browser throttle suite, use the dedicated isolated setup in `docs/e2e-local.md` and `.github/workflows/throttle-e2e.yml`. The workflow must not require production secrets. Preserve test logs/results as artifacts and do not call the browser E2E complete unless both named tests genuinely pass.
- Local scaffolds under `scripts/local-pg/` are test-only approximations where repository migrations omit live-schema objects. They are not production DDL or proof of production-schema parity.

## Source-of-truth map

- This `AGENTS.md` is the cross-cutting source of truth for agents and development tasks.
- Exact scan-throttle semantics: `docs/scan-limit-l1.md`; coverage and evidence: `docs/scan-throttle-coverage.md`.
- Reproducible isolated browser E2E setup: `docs/e2e-local.md`.
- Migration-specific behavior remains in checked-in SQL migrations and their contract/integration tests. Treat old sections of `AUDIT-REPORT.md` that are explicitly marked historical as snapshots; use its current-status notes only for dated verification evidence.
- Do not create a second competing policy/runbook. Update the relevant canonical document when a rule or verified result changes.
