# Existing staging: read-only preflight

## Approved staging upgrade — latest state supersedes preflight findings below

User subsequently approved option A: reviewed staging migrations/test fixtures and a free nonproduction preview, no existing-data reset/delete, no production operations. Reproduced the observed scaffold baseline locally and ran the exact generated forward-upgrade artifact: **20/20 native tests passed**.

Applied the 49 pending source migrations to `autodinetest` as one transactional connector migration, from a pinned Git commit `14a9391ef29e5c35323d3676f5e2844a5935b32b`, SHA-256 `d55a5828bb4771c671cc4c4cbd5dd1922d143a259eb75374bc27cb160e21c1db`. Original source hashes are recorded in `supabase_migrations.arena_staging_upgrade_manifest`, separate from historical ledger entries; no history reset/repair was performed. A temporary HTTP extension fetched the public pinned artifact, checksum was checked before execution, and the extension was removed in the transaction. Native proof is in `/tmp/staging-bundle-test.log`.

Post-upgrade connector verification: **49 manifest entries; 33 public tables; 0 restaurants / 0 orders preserved**; receipt and staff-TTS functions present; `restaurant-assets` exists; anonymous legacy ordering and arbitrary limiter execution both false; temporary HTTP extension removed. This is actual hosted staging schema evidence, not full Auth/Storage/browser certification.

Vercel existing project `new` has **branch-specific preview-only** test project URL/key/server credential, fresh QR signing secret, live mode, and expected-project guard configured for `arena/3711df6a-autodine`. Paid Gemini/Groq keys are blanked for this branch. Automatic deployment of this branch is explicitly disabled in `vercel.json` until the manual preview build is requested. Generic/production variables were not updated. The repository branch was pushed to make immutable artifacts available. App preview URL/build verification and hosted fixtures are the next actions; do not read the historical findings below as the post-upgrade state.

## Permission boundary (historical preflight)

User selected **read-only inspection** for `autodinetest` and indicated there is currently **no staging app URL**. No hosted SQL mutation, migration, Auth setting change, test-account creation, email send, bucket creation, fixture write/delete or deployment was performed. Production project was not queried for application data or modified. No API keys were retrieved.

## Observed metadata (not guesses)

Target: `autodinetest`, ref `juwyhslzchjevqkdvwjm`.

- Hosted PostgreSQL engine: 17; native CI matrix includes 15/17/18, remote jobs not yet executed.
- **7 migration history entries**, with generated versions differing from repository filenames. History includes an `autodine_local_test_scaffold` entry. It is not equivalent to the 55-migration clean native replay.
- **16 public tables**, all reporting RLS enabled. RLS-enabled alone does not certify correct policy/role behavior.
- Existing `place_public_order` has the old four-argument signature. Required current functions `mark_order_session_paid`, `close_order_session_and_issue_receipt`, `set_order_line_quantities`, `hit_rate_limit`, `table_order_activity`, `reserve_staff_tts_attempt` were absent from the inspected function list.
- `place_order(text,text,jsonb,text)` remains executable by both anon and authenticated. The local hardening that revokes it is **not deployed** to this project. Do not expose this staging as a production-ready ordering service.
- No rows returned from `storage.buckets`; required asset bucket is not provisioned in this inspected project.
- Auth `site_url`: `http://localhost:3000`; additional redirect allowlist empty. Email auth and signup enabled; email confirmation required. No custom SMTP host configured; email-send limit reports 2. This is not external delivery verification.
- No app staging URL supplied; browser→hosted Auth/REST/Storage/Realtime E2E cannot be run under the current read-only permission.

Only schema/config metadata was inspected; customer rows were not read.

## Safe plan, not executed against hosted resources

1. Preserve the read-only boundary until explicit hosted-write permission is supplied. No automatic migration repair, reset, push, regrant, schema reset or production deployment.
2. Review scaffold DDL and actual schema against clean replay. Prefer a separately authorized disposable database/project or a reviewed forward-only reconciliation; do not infer applied migrations solely from migration name text.
3. In that authorized target, replay schema/default-grant changes and verify legacy revoke, issued-document guards, order/session/payment RPC signatures, TTS budget, asset bucket and Storage role policies.
4. Build a separate **nonproduction** app from this branch with its own staging-only Supabase variables, canonical URL and `AUTODINE_MODE=live`. Never reuse production service keys. A paid deployment/resource requires separate approval.
5. Add only the exact staging auth callback origins; do not weaken production allowlists. Confirm email delivery mechanism/approved test inboxes before sending test mail. Do not disable confirmation merely to make tests green.
6. Seed isolated owner/manager/kitchen/cashier/viewer accounts and uniquely namespaced tenant fixtures. Configure the test suite's documented `E2E_*` values securely outside Git/chat.
7. Execute all skipped integration suites, persistence/relogin, cross-role/tenant denials, network retries, Storage publishing/removal, Realtime, staff-only voice plus real-device fallback, receipt print/PDF/share. Retain results and cleanup only known fixture identifiers.
8. Validate hosted backup/PITR, platform Auth/Storage recovery, realistic HTTP load/soak and external monitoring independently of local PostgreSQL tests.

## Newly verified locally

`npm run test:recovery:cold` creates a fresh private PostgreSQL cluster, replays all **55 migrations**, runs **20 native regression tests** including 40 concurrent staff voice-budget requests (exactly 30 admitted, 10 rejected), captures populated-table/policy/function-grant fingerprints, shuts down cleanly, copies a physical backup, **deletes the original temporary cluster**, restores from the backup, restarts on a new loopback port, and checks data/RLS/table grants/function privileges. Temporary clusters are cleaned up automatically.

Latest successful drill: **35 tables, 23 orders, 1 payment, 2 invoices recovered**, exact content fingerprints preserved; recovery phase **913 ms** for tiny fixtures. This is genuine **local cold physical recovery evidence**, not pg_dump/PITR, online backups, cloud restore, zero-downtime recovery, real RPO/RTO or Supabase service recovery. The logical dump/restore CI job remains unrun.

```sh
READINESS_PG_BIN=/path/to/matching/postgres/bin npm run test:recovery:cold
```

Requires `initdb`, `postgres`, `pg_ctl`; refuses to accept an existing data directory or database URL. Full local Supabase services remain untested here: Docker is unavailable, and emulated platform schemas are not the real Auth/Storage/Realtime services.
