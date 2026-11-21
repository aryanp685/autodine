# The throttle: what is proven, where, and what still needs a database

Written after the criticism that `curl '/menu?v=throttled'` is not evidence that
real throttling works. It was a fair criticism: that URL is something anybody can
type, and it bypasses every step between "Postgres refuses" and "the guest reads
a sentence". This file is the honest map.

## The chain, and which link each test actually covers

```
 Postgres decides          the route answers       the guest's screens
 ─────────────────         ──────────────────      ────────────────────────
 open_table_session   →    /t/<card> → 307   →    /menu…  →  cart  →  checkout
 returns 'limited'         ?v=throttled            banner     message   refusal
        │                        │                      │         │        │
        │                        │                      │         │        │
   ─────┴────────      ──────────┴─────────     ────────┴─────────┴────────┴─────
   check 06 §3, §4, §9   route.test.ts          app/menu/throttle-flow.test.tsx
   (NEEDS A DATABASE)    (in-process)           (in-process, real route + page
                                                 + server action, no shortcut)
```

| link | covered by | runs in CI | needs a DB |
| --- | --- | --- | --- |
| Postgres returns `limited` at the card/address limit | `supabase/checks/06_scan_limits.sql` §3 | **no** | **yes** |
| a refusal writes no session and no opens row | §4 | **no** | **yes** |
| a refusal is a status-only row (no token, no expiry) | §9 | **no** | **yes** |
| order submission is never throttled | §10 | **no** | **yes** |
| `limited` becomes `?v=throttled` + a cookie, never a session | `app/t/[token]/route.test.ts` | yes | no |
| the real page at that address shows the notice, above the food | `app/menu/throttle-flow.test.tsx` | yes | no |
| Place order refuses, writes nothing, and says "not sent" | same file | yes | no |
| the wait quoted matches what the server sent (and nothing is invented) | same file + `lib/scan-outcome.test.ts` | yes | no |
| the same attempt key is re-sent, so a retry cannot duplicate an order | same file | yes | no |
| an already-verified guest's order is untouched by a refused scan | same file | yes | no |
| a genuine throttle in a browser, against a real DB | `e2e/integration/throttle.spec.ts` | **yes** — dedicated isolated local PostgreSQL/PostgREST workflow | **yes**, disposable only |
| a genuine throttle through the real route + page + action, real SQL | `app/menu/throttle-db.integration.test.tsx` | **yes** — same workflow runs all four cases | **yes** — disposable local PostgreSQL 17.11 |

## Database-backed coverage and its limits

**Verified 2026-11-07:** workflow run [42398395823](https://github.com/aryanp685/autodine/actions/runs/42398395823)
ran both named Playwright tests and the existing `throttle-db.integration.test.tsx`
suite against disposable local PostgreSQL 17.11 and local PostgREST. The browser
result checker requires exactly **2 passed, 0 skipped, 0 failed**; the job passed.
The PostgreSQL suite's four cases also passed, including C4's concurrent
guest-token race. The workflow uploaded logs, test results, migration replay,
and per-test evidence for 30 days. Reproduction instructions are in
`docs/e2e-local.md`.

This was **not** a production clone. Missing live-schema objects use explicitly
marked, inferred local scaffolds, so the run proves the repository SQL and local
compatibility stack, not exact production-schema parity. No production services
or data were used. See the C4 follow-up in `AUDIT-REPORT.md`.

CI uses no production Supabase environment or secrets. The dedicated workflow
starts its own PostgreSQL database and local PostgREST service; the normal
hermetic suite remains independent of external services. The distinction is:

- `throttle-flow.test.tsx` covers app handling of `limited` through the real
  route handler, page, and server action with the Supabase boundary mocked;
- the database-backed integration and browser suites now execute real local SQL
  and browser traffic, but cannot establish parity with omitted live-schema
  definitions;
- the production wrapper's session-attachment regression is fixed by the
  forward migration; Supabase records it as `20261107123437`, and read-only
  inspection confirms it is active. The C4 race test was never run against
  production.

## Remaining production-fidelity check (separate from local C4)

The isolated local PostgreSQL run now covers all four `throttle-db` cases. A
branch-database clone would provide stronger confidence against the live schema,
but is not required to claim the local C4 test passed. The local harness is not a
production clone; its missing table shapes are inferred and labelled LOCAL ONLY.
Never point this test at production.

For an optional branch-clone check, restore a schema-only dump into an isolated
branch or disposable database, ensure the forward migration
`20261108006000_restore_public_order_session_attach.sql` is applied there, then run:

```bash
THROTTLE_DB_URL="$BRANCH_DATABASE_URL" \
  npx vitest run app/menu/throttle-db.integration.test.tsx
```

The browser E2E (`e2e/integration/throttle.spec.ts`) now runs in the dedicated
isolated workflow described above. It writes synthetic scan rows only to the
throwaway `autodine_e2e` database, which the runner drops at exit. Production is
never an acceptable target for either integration test. The forward SQL migration
has already been applied to production; do not replay it or run the integration
tests there.

## Why the hermetic suite cannot simply cover it

Three options were considered and rejected:

1. **Set a Supabase environment in CI.** `NEXT_PUBLIC_*` values are inlined at
   build time, so the whole app would then believe it is configured — every page,
   every dashboard route, every other browser test would call the same URL. One
   mock server would have to answer for the entire product to keep the suite
   green, and green would then mean "the mock answers", not "the app works".
2. **Seed a database in CI.** A real Supabase project per pull request is not a
   ₹0/month arrangement, and it needs a service key in the pipeline.
3. **Assert on `?v=throttled`.** That is the shortcut this document exists
   because of.

The in-process flow test is the compromise: it mocks exactly one boundary — the
Supabase client — with answers written to the SQL's own contract, and runs every
line of application code between that boundary and the guest.
