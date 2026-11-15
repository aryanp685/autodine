# Hosted synthetic acceptance — 2026-11-15 coordinated run

**Verdict: PARTIALLY EXECUTED — every leg this environment could reach PASSED; the remainder is genuinely blocked on repository secrets and staging GST-set authorization, not on product defects.**

Target: staging `juwyhslzchjevqkdvwjm` (`autodinetest`) ONLY. Production `bdbaqpevwmgdvghszjno` was never contacted by any call in this run. Synthetic fixtures only; no customer data; no writes outside the authorized S4 rehearsal apply and the manifest bookkeeping row.

## Environment under test

- Staging database: ACTIVE_HEALTHY, PG 17.11.0.018, ap-northeast-2. Auth/db/realtime/rest ACTIVE_HEALTHY.
- Staging app/preview: Vercel preview deployment(s) preserved READY (no READY preview was paused, deleted or retargeted by this run; pushes from this batch produced NEW branch previews via the git integration — see the session record). Preview env retains only staging-linked vars; preview `ADMIN_SECRET` absent (fail-closed); Gemini/Groq keys target production only. Deployment id under test: not applicable — no hosted browser session was established; no claim is made about app-level flows.

## What was EXECUTED and PASSED (this run)

| # | Check | Result |
|---|---|---|
| S0 | Explicit owner authorization naming `juwyhslzchjevqkdvwjm` — target confirmed via connector before the first query; production never named or used | PASS |
| — | `report_sales` rehearsal S1–S5 (preflight, capture, apply, verify) — see `docs/report-sales-staging-rehearsal-2026-11-15-result.md` | PASS |
| 8.1 | Owner **and manager** `report_sales` over 7-day window → `totals/buckets/orders` (Spice Route fixture; `billed_paise=576450`, 6 orders) | PASS |
| 8.2 | Cashier → **42501**; Kitchen → **42501** (direct RPC, JWT-claim sessions, `begin … rollback`). Unauthenticated route-level 401: NOT VERIFIED (needs HTTP session; see blockers) | PARTIAL |
| 8.3 | `p_order_limit=100000` → succeeds, 6 orders ≤ 10000; `totals` identical to `p_order_limit=200` call | PASS |
| 8.4 | >400-day range → **22023**; `p_bucket='week'` → **22023**; unknown timezone → UTC fallback; `p_include_lines=false` → `lines=[]` (19 lines with true) | PASS |
| 7.2 | Cross-tenant `report_sales`: owner → 42501; manager → 42501 (outlet `restro-only-veg`) | PASS |
| 6 | Dashboard/CSV/ops-alert role matrix: NOT VERIFIED over HTTP. DB-layer enforcement verified: `report_sales` EXECUTE limited to `authenticated`+postgres/service_role (unchanged by the migration); RLS enabled on `restaurant_invoices` and `payments`; 6 policies across finance/membership tables | DB-LAYER PASS |
| 7.1/7.3/7.4 | Catalog-level only. App-level two-tenant fixture walkthrough NOT VERIFIED (needs runner/browser). GST shared-GSTIN trigger: absent — GST migrations not applied to staging (see below) | PARTIAL |
| 5 | NOT VERIFIED — staging carries no GST/IRP schema (`restaurant_invoices` has no `gst`/`irp`/`irn`/`tax` columns; no GSTIN trigger). Applying `20261113000100`–`20261114000600` to staging was not authorized in this batch | BLOCKED-SCOPE |
| 1–4 | Auth signup/invitations, customer QR→order, kitchen Realtime/reconnect, cashier settlement, invoice issue/void/print/share — NOT VERIFIED. Require the hosted browser runner (`.github/workflows/staging-e2e.yml`) with `AUTODINE_STAGING_SERVICE_ROLE_KEY` + `AUTODINE_STAGING_SHARE_URL` (repository Actions secrets; the GitHub connection returns HTTP 403 for secrets) or the owner's manual browser pass | BLOCKED-SECRETS |
| 9 | Monitoring: NOT VERIFIED hosted. `GET /api/health` and `[autodine:alert]` lines need the staging runtime and a degraded-path trigger; the Vercel connector exposes build logs only, and no protected-preview HTTP access exists here. Offline guards pass in CI. Logs-only, delivery unverified — Resend not activated (per constraints) | BLOCKED-SECRETS/TOOLING |

## CI and workflow state at the end of this run (branch `arena/9b120325-autodine`)

- **CI** (`typecheck · lint · design · test · build` + PG 15/17/18 clean-migration matrix): **success** — including the previously failing logical-restore drill, which now passes end-to-end on CI (PGDG pg_dump/pg_restore 17, Mode A custom format, application-schema scope, ACLs preserved, fingerprint match vs the embedded PG 17.11 source).
- **E2E (browser)** and **Throttle browser E2E**: success.
- **Disposable Supabase E2E and load** (workflow_dispatch, run 43683792570): **success** — 64/64 hermetic Playwright, 89/89 migrations applied to a disposable local Supabase stack, **49/49 Supabase-backed integration tests**, then 5,000 synthetic guest sessions / 100 restaurants / concurrency 128: sessions fail=0 (p95=647ms), orders fail=0 (p95≈2.4s), app reads fail=0, kitchen Realtime fan-out 1500/1500 events, `overallFailures=0`. This is a disposable local stack — not hosted staging; it proves the chain and harness, not production.

## Fixes landed in this batch (tooling/CI defects; each re-verified by re-running the suite)

- `scripts/verify-logical-restore-embedded.mjs`: OS-assigned ephemeral port; failing step prints stack; accepts Mode A (`.dump.enc`) or Mode B (`.sql.gz.enc`) artifact; pgcrypto prerequisite created in the shimmed restore target.
- `scripts/ci/print-error-annotation.mjs` (new): failing-step log tail re-emitted as Checks-API annotations (the log CDN was unreachable — every log fetch EOF'd; annotations travel via api.github.com).
- `.github/workflows/ci.yml`: PGDG noble-pgdg registered; `postgresql-client-17` installed; `/usr/lib/postgresql/17/bin` pinned first on PATH (stock runner pg_dump 16 shadowed it); drill step tees its log; annotation step on failure.
- `.github/workflows/supabase-e2e-load.yml`: fixture-apply log tee'd; per-line annotation surfacing on failure.
- `scripts/backup/backup-logical.mjs`: Mode A dumps only the application schema (`--schema=public`) and keeps ACLs (dropped `--no-privileges`) — fixing the 264-entry ACL divergence and the auth/storage collision.
- `scripts/backup/restore-logical.mjs`: `pg_restore` scoped to the same schema.
- `scripts/e2e/prepare-local-supabase.mjs`: stale migration-count assertion 60 → 89 (all 89 replay cleanly on the disposable stack).
- `e2e/integration/cashier-flow.spec.ts`: stale counter-CTA expectation (₹125) → the fixture's ₹349.
- `scripts/e2e/load-local-supabase.mjs`: guest ordering routed through `place_public_order_attempt` (the anon contract since 20261110*), fixing a load run in which all 5,000 order attempts were rejected 42501 with `fail=5000`.

## Result, honestly stated

- report_sales authorization on staging is verified end-to-end at the database layer, for all four staff roles plus cross-tenant denial, after the authorized rehearsal apply.
- The full hosted customer→kitchen→cashier→settlement→invoice journey is **not** proven in this environment. It needs the owner to configure the two GitHub Actions secrets (or run the pass manually). No product blocker was found; none of these scenarios failed — they did not run.
- The disposable-stack suite (49/49 integration, 5k-session load) is green and reproducible from this branch head.
- Nothing here authorizes production. `report_sales` remains unapplied to production; the production backup gate is unmet; Resend is not activated; both pre-existing READY previews preserved; preview `ADMIN_SECRET` remains absent.
