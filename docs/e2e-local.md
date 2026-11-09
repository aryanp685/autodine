# Isolated browser E2E: QR scan throttle

This is the reproducible, production-free setup for the two tests in
`e2e/integration/throttle.spec.ts`. It exercises the real browser route, the
real Next.js menu page, PostgREST, and real PostgreSQL SQL functions. The test
writes synthetic `table_session_opens` rows only into the disposable
`autodine_e2e` database.

**Never set this up against a Supabase project, production URL, production
credentials, or production data.** `AGENTS.md` is the authoritative policy;
`docs/scan-throttle-coverage.md` records what each test proves.

## Reproducible CI runner (recommended)

The dedicated workflow is `.github/workflows/throttle-e2e.yml`. It runs on
`ubuntu-24.04`, starts a fresh PostgreSQL 17.11 service, downloads pinned
PostgREST 16.5, provisions a one-run anon JWT, builds the app against the local
PostgREST endpoint, and launches Playwright's Chromium. It uses no repository
secrets and has no production connection information. On failure or success,
GitHub Actions uploads the migration, API, browser dependency, and per-test logs
as `throttle-browser-e2e-evidence` for 30 days.

A green job counts as complete only when the result evidence says **2 passed,
0 skipped, 0 failed**. `--list`, a skipped test, or a unit/database-only test is
not browser E2E evidence.

## Sandbox-runnable PostgreSQL and Chromium checks

On the repository's Linux/Node 22 sandbox, `npm ci` followed by
`npm run test:db:local` starts an isolated embedded PostgreSQL 17.11 cluster
under a fresh temporary directory. It replays all 48 checked-in migrations,
adds only the already documented local Supabase shim and inferred scaffold,
checks the resulting objects and SQL regressions in
`supabase/checks/06_scan_limits.sql`, `07_p8_close_settlement.sql`, and
`08_p3_incremental_tickets.sql`, runs all five PostgreSQL-gated tests, and
destroys the cluster on exit. The same run
then performs a database-only synthetic workload (default 5,000 distinct
guests across 100 synthetic restaurants) with a 64-connection pool. This is a
local SQL throughput smoke, not a 5,000-concurrent-browser test or a forecast
of hosted Supabase capacity. The latest command used `LOCAL_LOAD_USERS=100`:
100 sessions and 100 SQL orders were verified; session-open took 307ms and
order-write took 860ms. Earlier 5,000-row measurements remain historical and
are not repeated-load evidence. Use a staged provider environment for any
hosted capacity claim.

`npm run e2e:demo` builds the hermetic demo-mode app and runs the 64
non-integration Playwright tests with Chromium from `@sparticuz/chromium`. The
wrapper extracts Chromium's bundled NSS/NSPR libraries into a fresh temporary
directory and checks every linked library before launch, so it needs neither
apt nor a system Chromium installation. The latest hosted browser workflow verified **64 passed,
0 skipped, 0 failed** for the hermetic project. `npm run e2e:local` remains the
unfiltered 111-test catalog command; without Supabase it reports 47 integration
cases as skipped, not verified.

### Full disposable Supabase suite and realistic load

`.github/workflows/supabase-e2e-load.yml` is the GitHub-hosted full-stack runner. It
uses the pinned Supabase CLI to start local Postgres 17 plus Auth, Storage,
Realtime and Studio, applies all 48 checked-in migrations plus only the marked
inferred local scaffold, creates random synthetic Auth identities and fixtures,
and builds the app against that loopback stack. It runs the hermetic 64 and the
47 database-backed Playwright tests in separate stages, so the complete 111-test
coverage has no skips. It then creates 5,000 synthetic guest sessions and orders
across 100 restaurants, measures Next.js menu reads, authenticated kitchen
updates and Realtime fan-out, and saves JSON metrics, test reports, traces and
screenshots as a 30-day workflow artifact. It uses no hosted project credentials
or production data and deploys nothing. A workflow definition is not evidence
until its run finishes; its uploaded per-test reports and `load-report.json` are
the evidence to retain. Run `42609513688` completed successfully: 64
hermetic and 47 Supabase-backed tests passed; all 1,500 kitchen events were
delivered (500 each for preparing, ready and served), with zero load failures.
That is evidence for this run only; repeat the isolated workload before treating
delivery as repeatedly verified.

This sandbox has no Docker/Podman daemon or container images and cannot reach
the container registries, so it cannot truthfully claim to have started the full
Supabase stack here. The embedded PostgreSQL runners remain a safe subset, not
a substitute for Auth, Storage, Realtime or Studio.

## Run locally on Linux

### Requirements

- Node.js version in `.nvmrc` (22), npm, `curl`, `tar`, `openssl`.
- PostgreSQL client tools (`psql`, `createdb`, `dropdb`). The database itself
  can be supplied by the temporary Docker container below or another **local**
  PostgreSQL 17 instance.
- Playwright Chromium and its Linux shared libraries. Install with
  `npx playwright install --with-deps chromium` (or, on a host where the command
  does not elevate for apt, `sudo npx playwright install-deps chromium` followed
  by `npx playwright install chromium`).
- Docker only if using the disposable database command below.

The sandbox's serverless Chromium binary was missing `libnspr4.so`, `libnss3.so`,
and `libnssutil3.so`. Playwright's `install-deps chromium` provisions those
along with the rest of the browser's OS dependencies. The run script calls
`scripts/e2e/check-chromium-runtime.sh`, which records `ldd` output, checks for
unresolved libraries, and explicitly verifies all three NSPR/NSS libraries.

### Start a throwaway PostgreSQL

In terminal 1, start a database container with no persistent volume:

```bash
docker run --rm --name autodine-throttle-e2e-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=autodine-local-only-e2e \
  -e POSTGRES_DB=postgres \
  -p 127.0.0.1:55439:5432 \
  postgres:17.11-bookworm
```

Leave it running. The E2E script rejects non-loopback `PGHOST` values, creates
only the fixed `autodine_e2e` database, applies all repository migrations plus
the clearly marked local-only scaffolds, seeds one synthetic scan-mode card,
then drops only `autodine_e2e` on exit. Stopping the container discards the
whole database cluster.

### Install, run, and inspect evidence

In terminal 2:

```bash
npm ci
npx playwright install --with-deps chromium
PGHOST=127.0.0.1 \
PGPORT=55439 \
PGUSER=postgres \
PGPASSWORD=autodine-local-only-e2e \
npm run test:e2e:throttle
```

The runner does the following in order:

1. Refuses remote database hosts and creates a fresh `autodine_e2e` database.
2. Replays `supabase/migrations/` with the existing local harness only, then
   loads synthetic data from `scripts/local-pg/900_local_seed.sql` and
   `scripts/local-pg/910_local_e2e_seed.sql`.
3. Runs PostgREST 16.5 on `127.0.0.1:3002` and a tiny loopback-only Node path
   proxy on `127.0.0.1:3001`. The proxy strips `/rest/v1` (the Supabase JS
   client's expected prefix) before forwarding to PostgREST; it does not alter
   API payloads or database behavior. It uses a random test-only
   `authenticator` password and a short-lived signed anon JWT generated by
   `scripts/e2e/create-local-anon-jwt.mjs`.
4. Builds and starts the app on loopback port `3100` with only the local API
   URL and local anon JWT. Playwright visits it as `http://localhost:3100` so
   the scan redirect and its host-only cookies stay on one origin. No `.env.local`
   or production credential is read.
5. Runs read-only Supabase-JS preflights for the storefront, QR-intro RPC,
   published menu, categories, items, and add-ons (no session mint or scan-budget
   spend), checks Chromium's linked libraries, and runs both throttle browser tests.
6. Runs the existing `app/menu/throttle-db.integration.test.tsx` suite against
   the same disposable PostgreSQL database (without changing or skipping those
   tests), then saves migration, seed, PostgreSQL integration, API preflight,
   PostgREST and path-proxy, Next build/start, `ldd`, Playwright JSON, and
   result-summary logs under `test-results/throttle-e2e/`;
   drops the one test database and stops the local processes on exit.

For cleanup, stop terminal 1 with Ctrl+C. The Docker container has `--rm` and
no mounted data volume. If these loopback ports are already occupied, override
`PGRST_PORT` (proxy, default `3001`), `PGRST_UPSTREAM_PORT` (PostgREST, default
`3002`), or `APP_PORT` (default `3100`) when invoking the npm script.

## Service and isolation details

- PostgreSQL host is loopback only; the runner refuses anything other than
  `127.0.0.1`, `localhost`, or `::1`.
- The database name is fixed to `autodine_e2e`; it is dropped before creation
  and dropped again by the exit trap. Do not change this to a production DB.
- PostgREST connects as a dedicated local `authenticator` role and switches to
  `anon` after JWT verification. The E2E-only seed grants SQL `SELECT` on the
  menu-facing tables, while the checked-in RLS policies still filter rows. The
  JWT secret and authenticator password are generated per run and never written
  to the repository.
- The QR token, restaurant, and menu entry are deterministic synthetic test
  fixtures. The E2E tests do not place orders and do not select or exercise GST
  treatment.
- The scaffolds in `scripts/local-pg/005_scaffold_missing_tables.sql` are
  inferred local test shapes, not production DDL. Passing this E2E proves the
  repository SQL + local compatibility stack, not exact live-schema parity.

## Evidence and the sandbox boundary

The sandbox can run the hermetic 64 with bundled Chromium, but it has no Docker
engine or image cache. The GitHub-hosted full-stack workflow is the route for
the 47 Auth/Storage/Realtime integration tests and the API/Realtime workload.
Retain and inspect its uploaded JSON/HTML reports and load metrics before
claiming those tests passed. The separate `throttle-e2e.yml` workflow remains a
PostgreSQL/PostgREST-only throttle check; it is not full Supabase evidence.
