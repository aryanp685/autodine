# Phase 7 — execution baseline (Phase 0)

**Phase 0 status: COMPLETE.** This is the read-only baseline for the sequential Master Launch Readiness execution. It records what was observed before any Phase 7 repository, hosted-configuration, deployment, or database mutation. Phase 1 begins only after this record; it does not authorize a hosted write.

**Authoritative task date:** 2026-11-06 UTC (Arena).

**Chronology exception:** the sandbox and both hosted PostgreSQL clocks returned 2026-11-13 UTC. The conflicting dates are preserved below; the later provider/runtime time is not substituted for Arena's authoritative date.

## 1. Checkout and protected work

- Repository: `aryanp685/autodine` at `/home/user/autodine`.
- Active branch: `arena/45ef88a9-autodine`; HEAD `9ac2b22c698b639f8fe82e8981e5182b86b7dc75`, the same commit supplied as this branch's base from `main`.
- The checkout is shallow/grafted. Its short local history is not a complete repository history.
- Tracked worktree was clean at baseline. The only untracked path was the pre-existing `AUTODINE-LAUNCH-READINESS-REPORT.md`; it was read as prior evidence and has not been changed or overwritten.
- Protected `scripts/phase3/staging-baseline.json` SHA-256 is still exactly `e986f2ddd48af88e7e887177ffab7f9dadbec96d6d8394f09150da1d9e7f03fb`.
- No source, hosted configuration, deployment, database, migration ledger, customer/test row, Auth setting, secret, or email was changed in Phase 0. No credentials or encrypted environment values were retrieved/decrypted.
- Node/npm/npx, Python, and GitHub CLI are available. `node_modules`, `.env.local`, `psql`, PostgreSQL client/server utilities, Docker/Podman/Nerdctl, Supabase CLI, and Vercel CLI are absent. The repository has an embedded/disposable PostgreSQL test runner; dependency installation and local tests remain possible after Phase 0.

## 2. Clock and chronology validation

| Source | Read-only observation | Assessment |
|---|---|---|
| Arena task context | 2026-11-06 UTC | Authoritative for this execution. |
| Sandbox `date -u` / Node | 2026-11-13 16:58:55–56 UTC | Seven calendar days ahead of the task date. |
| Production PostgreSQL (`bdbaqpevwmgdvghszjno`) | `now()` 2026-11-13 16:58:22.640 UTC; `clock_timestamp()` 16:58:22.641 UTC; timezone UTC; PostgreSQL 17.11 | Matches the runtime's future date. |
| Test PostgreSQL (`juwyhslzchjevqkdvwjm`) | `now()` 2026-11-13 16:58:22.453 UTC; `clock_timestamp()` 16:58:22.456 UTC; timezone UTC; PostgreSQL 17.11 | Within a fraction of a second of Production, but also seven days ahead of the authoritative task date. |
| Project / GitHub metadata | `autodinetest` creation is reported as 2026-11-08; `main` commit and PR #181 timestamps are reported on 2026-11-13. | These events post-date the authoritative task date. Treat provider chronology, trial/expiry/retention/rate-window results, and timestamp-based acceptance as unresolved until the owner confirms the authoritative clock. |

No clock was set or altered. Do not use current hosted time to validate trial, expiry, retention, scheduled-job, cooldown, QR/session-expiry, or migration-order boundaries. Local deterministic/synthetic tests may still be run, but their wall-clock date must be labeled and must not be promoted to hosted time acceptance.

## 3. Environment identity and separation

| Environment | Current identity/evidence | Boundary at baseline |
|---|---|---|
| Local | Active checkout at `9ac2b22c698b639f8fe82e8981e5182b86b7dc75`; no local DB client/container runtime or environment file. | Local code/tests only. Historical PR #182 test results are not a fresh rerun. No production URL or key was used. |
| Supabase Test / Preview candidate | The only non-Production Supabase project returned is `autodinetest`, ref `juwyhslzchjevqkdvwjm`, region `ap-northeast-2`, PostgreSQL `17.11.0.018`, `ACTIVE_HEALTHY`. Older repo documents and PR #181 call it Staging/Test. | A distinct Staging project was not returned. The current Vercel Preview/Development runtime-to-Supabase mapping was not freshly proved through a safe, redacted configuration read. Therefore `autodinetest` is the only candidate, not an accepted Staging target. No staging write or test fixture was created. |
| Production Supabase | `autodine-production`, ref `bdbaqpevwmgdvghszjno`, region `ap-south-1`, PostgreSQL `17.11.0.003`, `ACTIVE_HEALTHY`. | Kept separate from Test. Read-only catalog/health inspection only. No Production query read application rows. |
| Vercel | Project `new`; the prior read-only Production deployment record is `dpl_CRzZvm9ibidnUbpZ4HweDxPvG12C`, READY/PROMOTED for commit `9ac2b22c698b639f8fe82e8981e5182b86b7dc75`. The project-domain listing returned only the generated `new-alpha-five-43.vercel.app` alias (verified; no branded custom domain was listed). | Deployment metadata is not HTTP health or user-journey acceptance. The broad Preview deployment listing was truncated and is not treated as a complete inventory. No deployment or domain change was made. No environment variable was decrypted. |

The repo's historical isolation documents identify the intended rule (Production deployment only → Production Supabase; Preview/Development → non-Production), but a current Vercel environment-to-project proof is still required before using a Preview for acceptance. No real customer or Production test is permitted.

## 4. GitHub and migration collision

- GitHub API reports `main` at `9ac2b22c698b639f8fe82e8981e5182b86b7dc75`, with a committer timestamp of 2026-11-13. That SHA agrees with the local checkout; the timestamp conflicts with the authoritative task date.
- PR #181 (`Enforce owner-only billing settings and refresh launch audit`) is OPEN, head `ef61e9401bf965b1873b3e0f5fbe3c7dbc91c05a`, branch `arena/01715497-autodine`; the API reports base SHA `e13720652440fc69280caa09e2e60bc151288426`, older than the active `main`/checkout. PR checks were reported green, but the check/deployment chronology is also 2026-11-13 and is not current-release acceptance for this branch.
- Current `main` contains `supabase/migrations/20261112000200_immutable_restaurant_account_link.sql`. PR #181 adds a different file with the same numeric version: `20261112000200_owner_billing_configuration_guard.sql`. The two bodies are different and must never be merged/replayed as-is with a duplicate version. PR #181 has not been merged here; no PR or branch was changed.
- PR #181's report that the owner-only billing guard was applied on `autodinetest` is independently corroborated at catalog level: its migration listing contains `20261113115007 / owner_billing_configuration_guard`; `guard_restaurant_billing_configuration()` and its trigger exist, and the captured function definition matches the PR's checked-in source. Its database version is custom and does not make the conflicting `20261112000200` filename safe to merge.
- The PR guard only checks changes to `tax_rate_bps`/`gstin` and does not protect `restaurants.account_id`. Production does not have that billing-configuration trigger. Neither database has the account-link immutability trigger at this baseline.

## 5. Fresh hosted read-only evidence

### Service status and Realtime

Both projects reported `auth`, `db`, `db_postgres_user`, `pooler`, `realtime`, `rest`, `storage`, and `pg_bouncer` as `ACTIVE_HEALTHY`. In both Realtime detail payloads, however, `db_connected` and `replication_connected` were `false`. The service-health badge is not evidence of delivered events, reconnect behavior, or multi-device acceptance.

### Schema and tenant entitlement boundary

- Public table counts: Production 44; Test 42. The sampled catalog count was for ordinary/partitioned tables only. All returned public tables had RLS enabled (zero RLS-disabled tables in each result).
- Both catalogs contain `restaurants.account_id`; both report authenticated table UPDATE and `account_id` column UPDATE privilege as `true`. The row-level `restaurants_update` policy is membership/owner-manager scoped, not column scoped.
- No `restaurants_account_id_immutable` trigger or `prevent_restaurant_account_reassignment()` function was found in either project. Production's `restaurants` triggers included its plan guard and session-revocation trigger. Test's included the billing-configuration guard and plan guard.
- This is a live P0 entitlement boundary gap in both projects: authenticated code can still target the account-link column under the existing row policy. The local Phase 6D migration is not evidence of hosted application. No exploit request or data mutation was attempted.

### Direct table ACL and defaults

Read-only `pg_class`/ACL inspection found current over-privileges, despite RLS being enabled:

| Project | Direct current table grants to `anon` and `authenticated` (on 17 public tables owned by `postgres`) |
|---|---|
| Production | `MAINTAIN` |
| Test | `MAINTAIN`, `REFERENCES`, `TRIGGER`, and `TRUNCATE` |

`TRUNCATE` is not governed by row-level security. No destructive privilege was exercised. The direct ACL probes also found owner-specific `postgres` and `supabase_admin` default ACLs in `public` which still grant client-role privileges on future tables/sequences/functions; among them are PostgreSQL-17 `MAINTAIN` grants, and Test defaults additionally include `TRUNCATE`/`REFERENCES`/`TRIGGER`. This is a release-blocking ACL/default-ACL finding, not a claim that PostgREST exposes every SQL command. A full, owner-by-owner privilege/sequence/RPC inventory and narrowly tested forward repair are required before any hosted change.

The repo contains `20261110001220_revoke_client_bypass_privileges.sql` (for objects/defaults owned by its execution role) and a separate owner-specific `supabase/owner-operations/20261110000501_revoke_supabase_admin_client_defaults.sql`. Their existence is not evidence they ran. The returned Production ledger did not list `20261110001220`; Test has a custom/bundled history. Catalog residues remain. Do not replay either file blindly or grant role membership to bypass ownership boundaries.

### Named SECURITY DEFINER/RPC probes

Both projects returned the same results for the named helpers checked:

- `restaurant_can_write(uuid)`: SECURITY DEFINER, fixed `search_path=public`; executable by `anon`, `authenticated`, and `service_role`.
- `account_can_write(uuid)`: SECURITY DEFINER, `search_path=public, pg_temp`; not executable by `anon`, executable by `authenticated` and `service_role`.
- `create_account_with_restaurant(...)`: SECURITY DEFINER; service-role only.
- `create_outlet(text,text)`: SECURITY DEFINER; authenticated and service-role.
- `operational_schema_readiness()`: SECURITY DEFINER; service-role only.
- `public_restaurant_profile(text)`: SECURITY DEFINER; anon/authenticated/service-role.

These narrow checks do not certify all exposed RPC signatures, overloads, bodies, definer owners, search paths, grants, or app callers. A broader combined SECURITY DEFINER catalog result was truncated; it is explicitly not counted as a complete RPC review. The public entitlement probes remain a separate compatibility/security decision; no grants changed.

### Migration ledgers

- Production's returned ledger ends at `20261112000100`; it does not list `20261112000200`.
- Test has a custom/bundled history (including `arena_staging_forward_upgrade_55`) and ends with `20261113115007 / owner_billing_configuration_guard`; it does not list the account-link migration.
- Ledger names/versions are not a file-by-file application proof. Earlier local reports document legacy and bundled drift. No complete current catalog-probe artifact, function-body capture, or per-file `PRESENT`/`APPLY`/`REVIEW` classification was created in Phase 0. No ledger repair or migration replay is authorized by this baseline.

## 6. Auth, domain, recovery, and live acceptance

- Vercel's current project-domain listing had no branded domain, only the generated `.vercel.app` alias. Current Supabase Auth site URL/redirect allowlists and SMTP/provider configuration were not re-read in this baseline; historical Auth/SMTP notes are not fresh evidence. No API key or environment variable value was read, no secret was decrypted, and no mail was sent.
- No live `/api/health`, signup/confirmation/reset/invite, guest-order → staff → counter-settlement, Storage, Realtime, browser or device workflow was run. READY/PROMOTED, service health, green historical CI, and SQL catalog reads do not constitute current-release acceptance.
- The Supabase connector exposes no evidenced Backup/PITR/restore-status view in this execution. No current Production backup schedule, PITR window, retention, restore-point timestamp, backup artifact, restore, or contractual RPO/RTO has been verified. Existing local/historical restore reports and the older private backup reference are not a current hosted recovery proof. No backup or customer data was downloaded.
- No monitoring destination, acknowledged alert, operational SLO, incident owner, hosted capacity/soak result, device matrix, or real printer acceptance was established here.

## 7. Environment-separated evidence and initial verdict

| Evidence class | Baseline result |
|---|---|
| Local | Checkout identity/protected hash verified. Historical Phase 6D local PostgreSQL and Vitest results exist in prior records but have not been rerun on this execution baseline. |
| Test / Preview | Test project health and read-only catalog observations above. Current Preview-to-project configuration and current app flow acceptance remain unknown. |
| Staging | No distinct Staging Supabase project was returned; Test is only a candidate. No operator acceptance of that mapping or current-release Staging E2E is established. |
| Production | Project/service and catalog metadata only; immutable account-link guard absent and ACL/default-ACL risks present. No HTTP/customer journey, backup recovery, mutation, or release operation. |

**Initial release verdict: `NO-GO`.** Unknowns and skipped tests are not passes. The decisive open gates include the account-link security fix, overbroad existing/default ACLs, migration reconciliation/version collision, confirmed environment mapping, task/runtime/database clock discrepancy, current Auth/domain behavior, current-release staging acceptance, hosted recovery/RPO/RTO, monitoring/capacity and pilot-owner decisions. Production remains read-only until every required prerequisite and the separate Production gate are met.

## 8. Read-only evidence trace

- Supabase project list: request `b87570ee-2420-4342-aa84-9884406ca579`.
- Supabase service health: Production `db6492f2-1cf8-44de-ad27-6b76c3911441`; Test `445427f9-85c3-4658-9ed4-63c7ca46e7d1`.
- Migration lists: Production `b0f7cbf1-d086-4a49-928e-100390389305`; Test `38b4a229-5a9f-4dc0-bf0d-11a86d4f04eb`.
- Initial tenant/catalog probes: Production `4b71b07c-99b2-4f02-8dfa-c7b1916dfa97`; Test `b22c5035-89fa-4a50-912c-a07fcd5a73e0`.
- Clock probes: Production `ef01ee3b-4e96-4e30-812c-6bc67c0d3213`; Test `e689e788-87be-4302-baa2-305c132d7209`.
- Billing guard function definition on Test: `e85f40ad-3e00-4095-aa76-472f1200b2e0`.
- Direct table ACL owner/grantee summaries: Production `fa546adb-1e3c-4e2e-b02c-0d0b28cb5f34`; Test `7c4f327a-37fb-4c8e-b383-6acc27669d35`.
- Named RPC checks: Production `2491584d-f472-4aff-8e7d-0d9d83db3efb`; Test `cc2685e8-9c5b-40b7-8a85-cf1cadfab346`.
- Vercel project-domain listing: `6efc7a4e-1823-43d2-a26f-90589ff1e590`.
- GitHub PR #181: `https://github.com/aryanp685/autodine/pull/181`; PR/base SHA and timestamps are recorded in §4. No files outside this repository were created as evidence.

## 9. Phase 0 exit criteria

- [x] Project instructions and the current checkout/worktree were inspected; user work and protected baseline are preserved.
- [x] Current project identities, reported health, migration ledgers, account-link and billing guards, relevant ACLs, domain metadata, and the PR migration-version collision were read-only checked.
- [x] Required handoff, migration, security, Auth, Staging, Production, recovery, isolation, operations and E2E runbooks were inspected; historical claims are kept separate from fresh evidence.
- [x] A clock/chronology discrepancy was surfaced and explicitly carried as an unresolved gate.
- [x] Phase 0 baseline recorded before implementation/configuration work.

**Phase 0 outcome:** complete. Phase 1 may now proceed with a documented limited-pilot scope and explicitly unresolved owner decisions; no hosted mutation is implied.
