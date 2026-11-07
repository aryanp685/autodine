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
| a genuine throttle in a browser, against a real DB | `e2e/integration/throttle.spec.ts` | **no** | **yes** |
| a genuine throttle through the real route + page + action, real SQL | `app/menu/throttle-db.integration.test.tsx` | **no** (skips without `THROTTLE_DB_URL`) | **yes** — all 4 cases, including C4, passed on isolated local PostgreSQL 17.11 |

## The gap, stated plainly

**Update, 2026-11-07:** the database-backed suite has run on a disposable native
PostgreSQL 17.11 database built from all checked-in migrations plus the explicitly
marked local-only scaffolds. All four integration tests passed, including C4's
concurrent guest-token race. This was **not** a production clone, and the missing
live-schema objects use inferred scaffold definitions, so it is isolated local
validation rather than proof of exact production-schema behavior. See the
C4 follow-up in `AUDIT-REPORT.md`.

CI has no Supabase environment, by design — the browser suite is hermetic so the
pipeline needs no secrets. The consequence is exact and worth saying out loud:

- the application's handling of `limited` is proven by tests that drive the real
  route handler, the real page and the real server action (`throttle-flow.test.tsx`);
- the database-backed integration cases now execute real SQL locally, but do not
  establish parity with the live database's omitted table definitions;
- the production wrapper's session-attachment regression is fixed by a forward
  migration and verified locally, but production application remains a separate
  approval-gated database operation.

## Remaining production-fidelity check (separate from local C4)

The isolated local PostgreSQL run now covers all four `throttle-db` cases. A
branch-database clone would provide stronger confidence against the live schema,
but is not required to claim the local C4 test passed. The local harness is not a
production clone; its missing table shapes are inferred and labelled LOCAL ONLY.
Never point this test at production.

Before a branch-clone check, restore a schema-only dump into an isolated branch
or disposable database, apply the pending forward migration
`20261108006000_restore_public_order_session_attach.sql`, then run:

```bash
THROTTLE_DB_URL="$BRANCH_DATABASE_URL" \
  npx vitest run app/menu/throttle-db.integration.test.tsx
```

The separate browser E2E (`e2e/integration/throttle.spec.ts`) has not been run:
there is no browser binary in this environment, and it needs an isolated
branch deployment plus database credentials. It can write up to twenty-five
`table_session_opens` rows. Production is never an acceptable target for either
integration test. Applying the forward SQL migration to production is a distinct
operation and requires explicit approval.

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
