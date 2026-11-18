# report_sales security remediation — staging rehearsal preparation (2026-11-14)

**Status: prepared, NOT executed.** No hosted database — staging or production —
was accessed, changed, or applied to for this document. The apply step in §4 is
a checklist for an explicitly authorized operator or connector session; it has
not been run. Production apply is **not** authorized and remains a separate,
separately-gated decision. This document does not authorize anything by itself.

## 1. What is being rehearsed

One file, one function, signature-preserving:

- `supabase/migrations/20261112000300_report_sales_export_authorization.sql`
  - `create or replace function public.report_sales(...)` — argument types and
    defaults unchanged; `stable`, `security definer`, fixed `search_path = public`.
  - Adds: Owner/Manager predicate via `public.has_restaurant_role(p_restaurant_id,
    array['owner','manager'])` (errcode `42501`), a 400-day range cap (`22023`),
    `p_order_limit` clamped to `[0, 10000]` before any detail join, `p_bucket`
    restricted to `hour|day`, and an unknown-timezone fallback to UTC.
  - Grants unchanged: `authenticated` keeps EXECUTE; `public`/`anon` stay revoked.
  - No tables, columns, policies, triggers, data, or any other function are touched.

**Why:** Production runs a `report_sales` whose body never calls
`has_restaurant_role` (drift item 1 in `docs/migration-reconciliation.md`).
SECURITY DEFINER + no role predicate = any authenticated caller can pull any
restaurant's sales report and up to `p_order_limit` raw orders. This is the one
known drift with a direct confidentiality impact. The repository migration is the
approved fix; the sequence is: local verification → **staging rehearsal** →
production (separately authorized, not by this document).

## 2. Local verification (re-verified 2026-11-14 on the current committed tree, disposable PostgreSQL 17)

The figures below were re-derived on the current tree (HEAD `7a15d53`, 89 migrations incl. the GST set and `20261114000600`), not copied forward:

- `npm run test:db:report-sales-upgrade` — **9/9 PASS** (2026-11-14 re-run): pre-fix markers reproduce (`md5(prosrc)=8f3c9ddd35b47c1ce6b966c675e1e843`), pre-fix SECURITY DEFINER+stable, pre-fix grants authenticated-only, post-fix markers match the committed tree (`eab7538009ade8eeb2ff3bb53004fd73`), post-fix grants unchanged, Owner can call own outlet, Cashier refused 42501, re-application stable. The staging rehearsal itself remains authorization-gated (§4 S0).

| Check | Result |
|---|---|
| Replay of all **89** repository migrations | clean (2026-11-14, disposable PG 17) |
| `npm run test:db:embedded` | **8 files / 198 tests passed** |
| `lib/db/report-sales.integration.test.ts` | **26/26 passed** — Owner/Manager allowed own outlet; cashier/kitchen/unauthenticated rejected (42501); cross-outlet and unrelated-account rejected for both owner and manager (42501); default limit 200 with range-wide totals intact; 0/-25 limits return no details without changing totals; oversized limit capped at 10000; out-of-range integer inputs fail closed; 400-day range rejection retained and exactly-400-day range accepted; `hour` bucket accepted, other buckets (`week`/`month`/`fortnight`/empty) rejected with 22023; unknown timezone falls back to UTC instead of failing; `p_include_lines` gates line details; catalog assertions now also pin `public` and `service_role` EXECUTE as false; 400-day range rejection retained; existing authenticated-only grant and SECURITY DEFINER boundary retained |
| Export route tests (app `/dashboard/reports/export`) | pass — role checked before RPC, `no-store`, type whitelist, UTF-8 BOM CSV |
| Catalog markers after replay (post-fix state, re-derived 2026-11-14) | `SECURITY DEFINER`, `stable`, `plpgsql`, `search_path=public`, `md5(prosrc)=eab7538009ade8eeb2ff3bb53004fd73`, `md5(prosrc with whitespace collapsed)=e87b0ea6e50c60532c2093ccd3a17672`, EXECUTE for `authenticated` only (+ `postgres` owner); `anon`, `public` and `service_role` EXECUTE all false |
| Catalog markers stopping **before** `20261112000300` (the state staging should exhibit; re-derived 2026-11-14 by replaying the first 77 migrations) | same shape, `md5(prosrc)=8f3c9ddd35b47c1ce6b966c675e1e843`, `md5(prosrc with whitespace collapsed)=ea318d92857fb8af40b43aeb42ab75d1` |
| Source migration under rehearsal: `sha256` | `968ae47c3e785f5f6596d988be7df4e200a07f562343b494c1c0952295b874a4` (unchanged) |

## 3. Who can run which step

This sandbox has no route to Supabase or any hosted project (measured before;
unchanged this session). Every step below that touches a database is executed by
the owner/operator, or by an agent session the owner has explicitly authorized
with hosted staging write access for this purpose. Approval alone does not make
the sandbox able to see the project.

Target names (verify every time; do not trust memory or this file alone):

| | ref | use |
|---|---|---|
| Staging `autodinetest` | `juwyhslzchjevqkdvwjm` | the only approved rehearsal target |
| Production `autodine-production` | `bdbaqpevwmgdvghszjno` | **never** in this rehearsal; no reads beyond catalog-probe class reads without separate authorization |

## 4. The rehearsal sequence

### S0 — explicit authorization (gate, before anything else)

The owner names the staging project ref in writing/chat for this rehearsal. The
agent or operator confirms the target is `juwyhslzchjevqkdvwjm` and **not**
`bdbaqpevwmgdvghszjno`. If the session is an authorized connector session, the
first tool call is a read-only identity query; anything else aborts.

### S1 — read-only pre-flight

1. `select current_database(), version();` — expect PostgreSQL 17.x.
2. Confirm the staging ledger shape observed on 2026-11-14 still holds:
   `supabase_migrations.arena_staging_upgrade_manifest` present with ≥ 49
   records, newest through `20261109000900_staff_tts_budget.sql`; the staging
   Supabase ledger carries the six baseline entries including
   `arena_staging_forward_upgrade_55`.
3. Confirm `public.report_sales` pre-fix markers match §2:
   `md5(prosrc) = 8f3c9ddd35b47c1ce6b966c675e1e843` (or the whitespace-collapsed
   `ea318d92857fb8af40b43aeb42ab75d1` if the host stores it differently),
   `prosecdef = true`, `provolatile = 's'`. **If anything differs, stop.**
   Staging has drifted from the observed bundle state; do not apply, and
   investigate with the catalog probe first.
4. Confirm the prerequisite object exists (it must, after the bundle):
   `to_regprocedure('public.has_restaurant_role(uuid, text[])')` is not null.

### S2 — capture the rollback artifact (read-only)

Run `scripts/reconcile/capture-function-bodies.sql` against staging inside a
read-only transaction and save the `report_sales` definition (body + signature +
grants) next to the probe evidence. This is the only rollback source. Do this
even though the fix is forward-only by policy — capture-before-replace is the
repository rule for a reason (Rule 7 in `docs/migration-reconciliation.md`).

### S3 — backup disposition for staging (owner decision)

Staging holds synthetic fixtures only. The owner chooses:

- **(a)** rely on the S2 capture + the forward-only fix (no data is at risk; the
  change is a single function body), or
- **(b)** take a staging backup first.

Either is acceptable for staging. **Neither waives the separate production
backup gate** (hosted restore still unproven; see `docs/backup-restore-runbook.md`).

### S4 — apply (the only write step; staging only)

Apply exactly one file, in one transaction:

```
supabase/migrations/20261112000300_report_sales_export_authorization.sql
```

Do not bundle any other migration. Do not re-run `scripts/staging/approved-upgrade.sql`.
Record the application in `supabase_migrations.arena_staging_upgrade_manifest`
(`filename = '20261112000300_report_sales_export_authorization.sql'`,
`sha256 = 968ae47c3e785f5f6596d988be7df4e200a07f562343b494c1c0952295b874a4`),
same pattern the bundle used. The file is a `create or replace`; re-running it is
harmless but is not a substitute for the S1 checks.

### S5 — post-apply verification (read-only)

1. Markers now match §2 post-fix: `md5(prosrc)=eab7538009ade8eeb2ff3bb53004fd73`
   (whitespace-collapsed `e87b0ea6e50c60532c2093ccd3a17672`), still
   `prosecdef=true`, `provolatile='s'`, `search_path=public`.
2. Grants unchanged: `authenticated` EXECUTE; nothing for `anon`/`public`.
3. Functional checks against synthetic staging fixtures (operator-run, no real
   customer data):
   - Owner calls `report_sales` for their outlet over a 7-day window → returns
     JSON with `totals`/`buckets`/`orders`.
   - Same call as a Cashier-scoped role → error `42501` (`You do not manage this restaurant.`).
   - Same call by the Owner for a different, non-member outlet → `42501`.
   - `p_order_limit := 100000` → succeeds; returned `orders` array length ≤ 10000;
     range-wide `totals` unchanged versus a `p_order_limit := 200` call.
   - `p_bucket := 'week'` → `22023`. Range longer than 400 days → `22023`.
     `p_timezone := 'Mars/Olympus_Mons'` → succeeds and reports `timezone: 'UTC'`.
   - `p_include_lines := true` → `lines` present; `p_include_lines := false` →
     `lines = []`.
4. `operational_schema_readiness()` still answers the same as before the apply
   (this migration does not touch it; if it changed, something else was altered —
   stop and investigate).

### S6 — app-level smoke (read-only surfaces)

With a staging owner session and a staging cashier session (fixtures from
`scripts/staging/provision-e2e.mjs`):

- `GET /dashboard/reports/export?type=summary|orders|items` as Owner → `200`,
  `Content-Type: text/csv`, `Cache-Control: no-store`,
  filename `autodine-<type>-<localdate>.csv`.
- Same as Cashier → `403`. Unauthenticated → `401`.
- `?type=bogus` → `400`. Leading UTF-8 BOM present in the body.

No order, payment, or customer rows are created or modified by these checks.

### S7 — rollback (only if S5/S6 fail)

In one transaction: `create or replace` the pre-fix body verbatim from the S2
capture (byte-for-byte), re-verify the §2 pre-fix markers and the grants, then
stop and report. Do not improvise a repair on the host. The usual outcome of a
failed check is an investigation, not a rollback — rollback is for a function
that errors for callers.

## 5. Success criteria

- S5 markers and grants match byte-exactly; S6 behaves as listed; the manifest
  records the file and hash; evidence (marker query outputs, capture artifact,
  smoke results) is attached to the rehearsal record.
- Nothing else on staging changed. Nothing on production was touched.

## 6. Explicit non-goals

- No production apply, in any form, in this rehearsal. The production decision
  is separate and needs: proven hosted restore (or provider backup evidence),
  the S2-style capture on production, and the owner's explicit written
  authorization naming `bdbaqpevwmgdvghszjno`. None of those is satisfied today.
- No other staging migration is applied (`20261112000200`, `20261112000400`,
  `20261112000500`–`20261112000700` and the Phase 6 set stay as they are).
- No changes to grants, policies, RLS, or data.
- No claim that staging greenness implies production readiness.

## 7. Open items before the rehearsal can run

1. The owner's explicit authorization naming the staging project (S0).
2. The S3 backup disposition (a or b).
3. Who executes (operator, or an authorized connector session) and when.
4. Where the evidence will be filed (suggest `docs/` or the PR that carries the
   rehearsal report).

Until all four are in place, this stays preparation only.
