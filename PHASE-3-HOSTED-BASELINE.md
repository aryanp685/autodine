# Phase 3 — hosted baseline preparation

## Status

Phase 2 PR174 merged as 7147415052562aff971a236e79bf119977057271.
Release/preflight commit 471d0dd passed all reported CI checks before merge.
Main automatic Vercel Git deployment is temporarily disabled in vercel.json
pending coordinated schema/app cutover. Read-only provider inspection after
merge showed the latest production deployment still at 7dae9b4 (PR173), not
the new release. This is point-in-time evidence, not perpetual deployment
protection. No hosted database migration was performed.

## First bounded tool

`scripts/phase3/read-only-probe.mjs` is preparation for an HTTP baseline, not an
ordering-capacity test. It permits only loopback targets or the exact existing
nonproduction Supabase project REST root. It rejects production/external hosts,
embedded URL credentials/query strings and privileged staging keys. Defaults:
10 sequential GET requests with a one-second gap, five-second timeout,
maximum 30 requests, no redirect following, stop on first non-2xx/transport
failure. Emits response-header latency percentiles and status only, never
response payloads or credentials. No write/RPC/fixture/charge capability.

Tests (no external traffic):

```sh
node --test scripts/phase3/read-only-probe.test.mjs
```

Optional staged execution, only when a secure staging publishable key is
configured locally (never paste it into chat/command history):

```sh
PHASE3_TARGET=https://juwyhslzchjevqkdvwjm.supabase.co/rest/v1/ \
node scripts/phase3/read-only-probe.mjs
```

The tool reads PHASE3_STAGING_PUBLISHABLE_KEY from a secure local environment.
This session has NOT run this against hosted services. Unit tests use mocked
fetch and do not measure real latency. Supabase REST-root header timing does
not exercise the app, order transactions, locks, pool capacity, shared-Wi-Fi
limits or real REST counter persistence.

## Next required work

1. Establish approved matching hosted app/schema and isolated synthetic tenant;
   do not use the production-connected preview as a load target.
2. Verify REST counter commit semantics and proxy provenance without customer
   data or secrets in reports.
3. Add fixture-scoped scan/order workloads with total request bounds and stop
   thresholds; separate expected rate-limit refusals from errors.
4. Gather query plans/lock waits/pool metrics alongside staged traffic; compare
   changes only with measured bottleneck evidence.
5. Report observed rates, p50/p95/p99, error/refusal counts, duration and exact
   app/schema SHA. Peak/soak certification belongs to Phase4, not this baseline.

Independent review, complete ownership/ACL recovery rehearsal and coordinated
production cutover remain outstanding. No capacity or production-readiness claim
is made by creating this harness.
