# D2 — PostgreSQL maintenance/bypass ACLs on public tables: remediation runbook (2026-11-15)

**Status: fix prepared and locally rehearsed on disposable PostgreSQL 17. NOT applied to any hosted project.** The hosted residual (17 `postgres`-owned `public` tables retaining `MAINTAIN` in Production, and `MAINTAIN`+`TRUNCATE`+`REFERENCES`+`TRIGGER` in Test) remains until the owner authorizes the release items below. RLS does **not** defend `TRUNCATE`; `MAINTAIN` (PG 17) is maintenance authority, not an app permission.

## 1. Exact scope statement (from dated read-only evidence; no new hosted access)

- Production (`bdbaqpevwmgdvghszjno`): anon/authenticated retain `MAINTAIN` on 17 `postgres`-owned public tables. `20261110001220_revoke_client_bypass_privileges.sql` has **no footprint** (never applied; see `docs/migration-reconciliation.md` §ledger).
- Test/staging-classified project: same 17 tables retain `MAINTAIN`, `TRUNCATE`, `REFERENCES`, `TRIGGER`; client `postgres` default ACLs also grant them.
- `supabase_admin` default ACLs additionally grant `REFERENCES`, `TRIGGER`, `TRUNCATE`; the owner operation `supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql` is prepared but **not evidenced as run anywhere**.
- The exact 17 table names are recorded only by the hosted catalog (they were probed as fingerprints, not names, in `scripts/reconcile/evidence/production-2026-11-14-catalog-probe.json`). The owner obtains them with the preflight probe in §3 — do **not** guess the list, and do not "fix" by dropping roles.

## 2. Why two artifacts are required (grant-source aware)

A `revoke` only removes grants made by the revoking role. Nothing else:

| Artifact | Executor | What it clears |
|---|---|---|
| `supabase/migrations/20261110001220_revoke_client_bypass_privileges.sql` (existing, unchanged, part of the reviewed release) | release migration runner (`postgres`) | Current: `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` revoked on every public table/sequence **owned by the executing role**; own schema-public default privileges for tables and sequences revoked. PG17-aware; no-ops cleanly on earlier majors. |
| `supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql` (existing, unchanged, never automatic) | **owner**, connected as `supabase_admin` | Current: same four privileges revoked on ALL public tables/sequences (grantee side regardless of grantor); `supabase_admin` schema-public default privileges for tables and sequences revoked. Refuses to run as any other role. |

If a table's bad grant was made by `postgres` → the migration clears it. If made by `supabase_admin` → the owner operation clears it. If made by anyone else → the §3 probe reports it, and the answer is **that role's** revoke — never a blanket `PUBLIC` re-grant, never a role drop.

Preserved, deliberately: ordinary `SELECT/INSERT/UPDATE/DELETE` table DML for the RLS-backed app; `anon` schema USAGE; `service_role` sequence USAGE; the migration owner's own objects; `postgres`/`supabase_admin` superuser authority. No policy, RLS flag, function grant or app behavior is altered.

## 3. Owner preflight probe (read-only; capture output out-of-band)

```sql
-- 3a. The 17 tables + every grantor/grantee/privilege triple for the four privileges.
select n.nspname as schema, c.relname as table, owner.rolname as owner,
       coalesce(nullif(acl.grantee::regrole::text, '0'), 'PUBLIC') as grantee,
       acl.grantor::regrole as grantor, acl.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles owner on owner.oid = c.relowner
  cross join lateral aclexplode(coalesce(c.relacl, '{}')) as acl
  -- relacl empty means default grants for PUBLIC of none; still list relacl-null owners:
 where n.nspname = 'public' and c.relkind in ('r','p')
   and acl.privilege_type in ('MAINTAIN','TRUNCATE','REFERENCES','TRIGGER')
 order by 1,2,4,5;

-- 3b. Same for sequences.
select n.nspname, c.relname, owner.rolname as owner,
       coalesce(nullif(acl.grantee::regrole::text, '0'), 'PUBLIC') as grantee,
       acl.grantor::regrole as grantor, acl.privilege_type
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_roles owner on owner.oid = c.relowner
  cross join lateral aclexplode(coalesce(c.relacl, '{}')) as acl
 where n.nspname = 'public' and c.relkind = 'S'
   and acl.privilege_type in ('USAGE','SELECT','UPDATE')
 order by 1,2,4,5;

-- 3c. Default ACLs that will re-poison future objects (the silent re-grant
--     source). Run as the default-privilege owner (postgres, and separately
--     as supabase_admin):
select r.rolname as grantor, d.defaclobjtype,
       coalesce(nullif(acl.grantee::regrole::text, '0'), 'PUBLIC') as grantee,
       acl.privilege_type
  from pg_default_acl d
  join pg_class c on c.oid = d.defaclnamespace
  join pg_namespace n on n.oid = c.oid and n.nspname = 'public'
  join pg_roles r on r.oid = d.defaclrole
  cross join lateral aclexplode(d.defaclacl) as acl
 where acl.privilege_type in ('MAINTAIN','TRUNCATE','REFERENCES','TRIGGER','USAGE','SELECT','UPDATE');
```

Expected: rows naming 17 postgres-owned tables (3a); possibly sequences (3b); default-ACL rows (3c) showing `anon`/`authenticated`/`PUBLIC` with the four table privileges for both owners. **Save all three outputs with the production change record. This is the exact "before" fingerprint.**

## 4. Apply sequence (authorized release only — never from this repo session)

1. Release Batch A (pre-GST) is staged/deployed per `docs/production-release-baseline-2026-11-14.md` §7 steps 0–3 **first** — D2 rides the same release, after the app is serving.
2. `20261110001220_revoke_client_bypass_privileges.sql` applies as part of that reviewed release (it is already in the branch and ordered in the chain).
3. Owner connects as `supabase_admin` and runs `supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql` verbatim. It refuses any other role. Not part of CI, not automatic.
4. Re-run §3 probes: **zero rows** expected from 3a/3b for grantees anon/authenticated/PUBLIC; 3c shows no client-role rows for either grantor. Any residual row names its grantor — the revoke for that grantor is the missing step; report, do not improvise.
5. Bounded app verification (read-only): `/api/health` ok; one authenticated staff page load; one QR menu fetch; confirm function EXECUTE posture unchanged (`to_regprocedure` census vs the preflight capture).

## 5. What this does to the application (verified locally, not by hope)

`lib/db/readiness.integration.test.ts` ("removes browser maintenance and sequence access for current and future public objects") proves on the disposable cluster with the **full migration chain applied**, including the fixtures `acl_existing_postgres`, `acl_existing_postgres_seq`, `acl_existing_supabase_admin`, `acl_existing_supabase_admin_seq`:

- client roles keep ordinary `SELECT/INSERT/UPDATE/DELETE` on existing and **future** public tables (RLS still applies behind those grants);
- client roles end with **zero** `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` on any current public table, and identical posture for objects created after the defaults revoke — for both grantor classes;
- client roles keep **zero** `USAGE/SELECT/UPDATE` on any current or future public sequence; `service_role` keeps sequence USAGE;
- `anon` keeps schema USAGE but not schema CREATE;
- ordinary app column grants (e.g. `authenticated` on `orders.prep_status`) intact; `service_role` retains the RPC grants it needs.

Normal behavior (RLS isolation, tenant boundaries, financial read roles, billing RPCs, notes/invoice flows, order placement/settlement) is exercised by the same run: **10 suites / 212 assertions green.**

## 6. Residual risks and honesty limits

- The "17" table census must be re-derived from 3a output at apply time; the count here restates dated evidence, not live state. If 3a returns fewer or different rows, proceed with the same two artifacts and record the delta.
- Default privileges only protect objects created **after** the change; existing tables rely on §3a going to zero.
- This does not remediate a `supabase_admin`-granted MAINTAIN on a **future** table created before 3c is clean for that owner — hence 3c is part of the same sitting.
- No claim is made that any hosted project currently satisfies §4.4. Local and disposable evidence prove the artifacts; hosted state proves itself only under §4.
- Rollback, if an app breakage is traced to the ACLs: re-grant the specific privilege on the specific table to the specific role (e.g. `grant truncate on public.x to authenticated` is still a grant of a powerful privilege — prefer fixing the caller). No routine rollback is expected; the revokes remove only maintenance/bypass privileges no app path uses.
