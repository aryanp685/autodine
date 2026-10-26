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
| a genuine throttle through the real route + page + action, real SQL | `app/menu/throttle-db.integration.test.tsx` | **no** (skips without `THROTTLE_DB_URL`) | **yes** — run locally, 3/3 passed |

## The gap, stated plainly

**Update, 2026-10-26:** a database-backed throttle *has* now run — against a
local PostgreSQL 16.2 built from this repository's migrations, not against
Supabase and not against a production clone. Ten `PASS` blocks and three
integration tests passed; see `docs/validation-local-pg-2026-10-26.md`. The
paragraph below still describes the CI situation, which is unchanged, and the
fidelity gap that only a branch database closes.
CI has no Supabase environment, by design — the browser suite is hermetic so the
pipeline needs no secrets. The consequence is exact and worth saying out loud:

- the application's handling of `limited` is proven by tests that drive the real
  route handler, the real page and the real server action (`throttle-flow.test.tsx`);
- the database's *production* of `limited` is proven by SQL that has never been
  executed on this branch, because the migration it needs is not applied;
- the join between those two — a real Postgres refusal reaching a real browser —
  is proven by **nothing that has run**. Two artefacts exist to close it, and
  both need you to run them against a branch database.

## Closing it, step by step

### 1. Where to do it

A branch database (Supabase dashboard → Branching), restored from the live schema
with `pg_dump --schema-only`, then:

```bash
psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261028000900_guest_scan_confirm.sql
```

`supabase/migrations` alone cannot build a fresh database (three tables are
created by no migration), which is why the schema is cloned first — see
`docs/migration-20261028000900-review.md` §2.

### 2. Prove the database side

```bash
psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/checks/06_scan_limits.sql
```

Ten blocks, each printing `PASS n: …` or raising `FAIL n: …`. The whole file runs
inside a transaction that ends in `rollback`, so it is safe to repeat. Expect
`PASS 9` to report `retry column present=false` — that is the fact the screens are
written against today.

### 3. Prove the browser side

Put one restaurant on `scan` mode (dashboard → Settings → verification), copy a
live card token, point the integration config at that deployment:

```bash
E2E_BASE_URL=https://<branch-deployment> \
E2E_QR_TOKEN=<card public token> \
npx playwright test --config playwright.integration.config.ts
```

It scans the card from a fresh context each time — a new guest every time, so
every scan asks the database to mint — until the refusal arrives (ten per card,
twenty per address, so it cannot take more than twenty-five attempts), then
asserts what the guest sees: the notice above the food, the menu still readable,
no success copy, no code form, and a retry number only if the server sent one.

**This has not been run.** There is no browser binary in the environment this
branch was developed in (`npx playwright install chromium` is blocked there) and
no database to point it at. `npx playwright test --config playwright.integration.config.ts --list`
does pass, which proves the spec parses and is wired to the right files — nothing
more.

It writes up to twenty-five rows into `table_session_opens`. A branch database is
the right target; production is not.

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
