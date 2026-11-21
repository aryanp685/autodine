# report_sales security remediation — staging rehearsal result (2026-11-15)

**Outcome: S0–S6 executed on staging `juwyhslzchjevqkdvwjm` (`autodinetest`) only. S5 green. No production contact. No rollback needed (S7 unused).**

Runner of record: authorized Arena connector session (Supabase + GitHub + Vercel), under the owner's explicit 2026-11-15 batch authorization naming `juwyhslzchjevqkdvwjm` as the only approved hosted target. Evidence is minimized: synthetic fixtures only; no tokens, keys or customer data.

## Target confirmation (before any tool call touched the project)

- `list_projects`/`validate_credential`: credentials valid. Projects visible: `autodinetest` (`juwyhslzchjevqkdvwjm`, ACTIVE_HEALTHY, `db.juwyhslzchjevqkdvwjm.supabase.co`, PG 17.11.0.018, ap-northeast-2) and `autodine-production` (`bdbaqpevwmgdvghszjno`, ACTIVE_HEALTHY) — production ref was never used for any query in this rehearsal.
- `get_project_health` (staging): auth/db/realtime/rest all ACTIVE_HEALTHY; realtime `db_connected: false` as reported by the provider (heartbeat green).
- `select current_database(), version()` → `postgres`, `PostgreSQL 17.11 on x86_64-pc-linux-gnu …`.

## S1 — read-only pre-flight

| Check | Result |
|---|---|
| Staging upgrade manifest | `supabase_migrations.arena_staging_upgrade_manifest` present, **49 records**, newest `20261109000900_staff_tts_budget.sql`, newest `applied_at` 2026-11-09 — matches the documented bundle state exactly. |
| Staging Supabase ledger | `supabase_migrations.schema_migrations` holds **10 entries** (`20261108091547 … 20261113115007`), not the six documented on 2026-11-14. Two additions beyond the 2026-11-09 bundle window and the original baseline: `operational_readiness_catalog_probe` (2026-11-09) and `owner_billing_configuration_guard` (2026-11-13, created by the owner's account). Neither touched `public.report_sales` — proven by the byte-exact md5 below. Recorded here as a divergence from the 2026-11-14 observation, not as a blocker; stop-conditions attached to the `report_sales` markers were all green. |
| `public.report_sales` pre-fix markers | `md5(prosrc)=8f3c9ddd35b47c1ce6b966c675e1e843`, whitespace-collapsed `ea318d92857fb8af40b43aeb42ab75d1`, `prosecdef=true`, `provolatile='s'`, `search_path=public`, comment "Members only". **Exact match to the documented pre-fix state.** |
| `to_regprocedure('public.has_restaurant_role(uuid, text[])')` | resolves — prerequisite present. |
| Grants pre-apply | `authenticated`, `postgres`, `service_role` EXECUTE; nothing for `anon`/`public`. |

## S2 — rollback artifact (captured before any write)

- Captured the live definition (signature, `pg_get_functiondef`, md5, owner, grants, comment) to `scripts/reconcile/evidence/staging-report-sales-capture-2026-11-15.json`.
- Byte-exact rollback source verified in-repo: `supabase/migrations/20261021000009_report_sales.sql` replays to `md5(prosrc)=8f3c9ddd35b47c1ce6b966c675e1e843` in disposable PG 17 (this session re-derived, not copied).
- Rollback procedure if ever needed: `create or replace` that file's `report_sales` verbatim in one transaction, then re-verify the pre-fix md5 above. Not invoked.

## S3 — backup disposition

Owner pre-approved **catalog-capture-only** for this rehearsal. Preflight confirms it is safe and sufficient for this change: signature-preserving `create or replace` of one function, no tables/columns/policies/triggers/data touched, capture artifact + repo byte-match in hand. No staging backup taken. **The separate production backup gate is untouched and unwaived by this; hosted restore remains unproven anywhere.**

## S4 — apply (the only write step)

- Applied exactly one file via the connector's `create_migration` (single transaction, rolls back on failure), name `report_sales_export_authorization`, query = `supabase/migrations/20261112000300_report_sales_export_authorization.sql` (sha256 `968ae47c3e785f5f6596d988be7df4e200a07f562343b494c1c0952295b874a4`, re-verified against the working tree).
- Recorded in `supabase_migrations.arena_staging_upgrade_manifest`: `filename='20261112000300_report_sales_export_authorization.sql'`, `sha256=968ae47c…`, `applied_at=2026-11-15 05:15:35.197296+00`.

## S5 — post-apply verification (read-only unless noted)

| Check | Result |
|---|---|
| md5 markers | `eab7538009ade8eeb2ff3bb53004fd73` / collapsed `e87b0ea6e50c60532c2093ccd3a17672` — exact post-fix match; still `prosecdef=true`, `provolatile='s'`, `search_path=public`; comment now "Owner/manager only … capped at 10000". |
| Grants | unchanged: `authenticated`, `postgres`, `service_role`; `anon`/`public` still none. The migration carries no ACL statements. |
| `operational_schema_readiness()` | `{invoices:true, settlement:true, orderSessions:true, paymentReceipts:true, announcementClaims:true}` (no pre-apply baseline taken this session; function untouched by this migration). |
| Owner call (Spice Route, synthetic fixtures) | 7-day window → JSON with `totals`/`buckets`/`orders`/`top_items`/`categories`; 6 synthetic orders; `billed_paise=576450`, `average_bill_paise=96075`. |
| Manager call (same outlet) | same shape, identical totals. |
| Cashier call | **42501** `You do not manage this restaurant.` |
| Kitchen call | **42501** (same predicate path). |
| Owner, outlet not a member (`restro-only-veg`) | **42501**. |
| Manager, outlet not a member | **42501**. |
| `p_order_limit=100000` (owner) | succeeds; `orders` length 6 (≤ 10000); `totals` byte-identical to `p_order_limit=200` call. |
| `p_bucket='week'` | **22023** `Bucket must be hour or day.` |
| Range 500 days | **22023** `Reports cover at most 400 days.` |
| `p_timezone='Mars/Olympus_Mons'` | succeeds, reports `timezone: 'UTC'`. |
| `p_include_lines` true / false | 19 lines present / `lines=[]`. |

Method note for the role-scoped calls: executed as `begin; set local request.jwt.claims='{"sub":"<synthetic user uuid>","role":"authenticated"}'; select …; rollback;` against the direct database endpoint — read-only, transactional, no writes. `auth.uid()` resolves through the claim, so `has_restaurant_role` evaluated exactly as it does for app sessions.

## S6 — app-level smoke (partially blocked)

Route-level checks (`/dashboard/reports/export` 200/403/401/400, BOM, `no-store`, filename) require an authenticated browser session against the staging preview, which sits behind Vercel Deployment Protection and needs the authorized share link (`AUTODINE_STAGING_SHARE_URL`). That value is not configured for this connection (GitHub Actions secrets return 403 — see blocker list). **Not executed; no claim is made about S6.** The RPC-level authorization semantics S6 ultimately depends on were verified in S5.

## S7 — rollback

Not needed.

## What staging still does NOT carry (important for the acceptance run)

The staging bundle ends at the 2026-11-09 upgrade plus this single function. The GST set (`20261113000100`, `20261114000100`–`20261114000600`), serialization migrations (`20261112000500`–`20261112000700`) and `20261112000400`/`20261112000200` are **not applied** — confirmed empirically: `restaurant_invoices` has no `gst`/`irp`/`irn`/`tax` columns and no GSTIN-related trigger exists. Acceptance scenarios §5 (GST modes, e-Invoice issuance/follow-up) therefore cannot be exercised on staging without separate, explicit authorization to apply those migrations.

## Non-goals restated

No production apply in any form; staging greenness implies nothing about production. No granted ACL changed. No GST migrations applied or waived. The `service_role` EXECUTE present before this rehearsal remains present after it (the migration carries no ACL changes and changing it was out of scope); flagged for the production-gate discussion.
