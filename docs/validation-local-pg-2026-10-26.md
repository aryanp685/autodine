# What was executed on 2026-10-26, and on what

The two things that had never run — the migration and a database-backed throttle
— have now run. This file records exactly where, with the real outputs, and the
one caveat that decides how much they are worth.

## The caveat, first

**This was not your branch database, and it is not a production clone.** No
Supabase project was reachable from the environment these were run in, and no
credential was used or requested. What was run is:

> PostgreSQL **16.2**, started locally, built by applying **the repository's own
> 26 migrations in order**, plus a shim for the Supabase objects those
> migrations expect (`auth.uid()`, the `anon`/`authenticated` roles, the
> `supabase_realtime` publication, `storage.buckets`/`objects`), plus a
> **scaffold** for the three tables that exist in the live database but were
> never checked in (`table_qr_codes`, `table_verification_sessions`,
> `qr_verification_attempts`).

So: the SQL in this repository is proven to run and behave. The production
schema's exact shape is **not** proven — that still needs your branch, built from
`pg_dump --schema-only`, as `docs/branch-db-validation.md` describes.

The harness is reproducible: `scripts/local-pg/run.sh`.

## Results

| step | what ran | result |
| --- | --- | --- |
| build | 26 migrations + shim + scaffold | **all applied** |
| S2 preflight | `scripts/branch-db/00-preflight.sql` | identity row, `0/0/0/0` counts, 7 prerequisites **all `t`**, migration objects **absent** |
| S3 before | `01-verify-before.sql` | three empty result sets, `orders = 0` |
| S3 rollback | `02-capture-rollback.sql` | **2** `CREATE OR REPLACE FUNCTION` bodies captured, 31,916 bytes |
| S4 apply | `20261028000900` in one transaction (`psql -1`) | **no errors** |
| S5 after | `03-verify-after.sql` | columns, 4 indexes, RLS `t` / 0 policies / 0 client grants, 6 functions all definer + `search_path=public`, grants `t,f,t,f` |
| S6 behaviour | `06_scan_limits.sql` | **PASS 1 … PASS 10**, then `ROLLBACK` |
| S7 equivalent | `app/menu/throttle-db.integration.test.tsx` | **3/3 passed** against the real database |

### The ten blocks, verbatim

```
PASS 1: a code-mode restaurant refuses to mint from a scan
PASS 2: 9 legitimate scans (opened=9, reused=0) — none refused
PASS 3: the limit is enforced and reported (14 of 15 refused)
PASS 4: a refusal writes nothing (status=limited)
PASS 5: held order L-1001 is persisted and visible to the board
PASS 6: second confirm is a no-op (first=1, second=0)
PASS 7: guest_token uniqueness is backed by an index
PASS 8: anonymous confirm refused (Sign in to confirm a table.)
PASS 9: a refusal is status-only (15 refusals); retry column present=f (app currently says "a short while")
PASS 10: place_public_order never reads the scan limit (2218 chars checked)
```

Full log, unedited: `docs/validation-local-pg-2026-10-26.log`.

### The three integration tests

`app/menu/throttle-db.integration.test.tsx` runs the shipped route handler, the
shipped page, the shipped server action, and the **real** `open_table_session` /
`public_qr_intro` / `place_public_order` SQL — only the Supabase REST transport
is replaced (`.rpc()` → `select * from public.<fn>(…)` over `pg`). It skips
unless `THROTTLE_DB_URL` is set, so CI never pretends to have run it.

1. **the eleventh scan is refused, and the menu says so** — ten guests scan, the
   eleventh lands on `?v=throttled`; the withheld session cookie is absent; the
   rendered page shows "Table check paused" above the food; `table_session_opens`
   holds exactly 10 rows.
2. **the refused guest's order is not written, and the retry refuses the same
   way** — two presses of Place order produce one identical message beginning
   "Your order was not sent.", and `orders` is unchanged.
3. **the same guest can order once the window passes** — the opens are aged out,
   a fresh scan mints a session, and `place_public_order` writes a real order
   whose `hold_required = false` in `scan` mode.

## What this changes

`docs/scan-throttle-coverage.md` and `docs/branch-db-validation.md` claimed the
database side was unproven because a database was out of reach. Half of that is
now wrong: the SQL runs and behaves. What is still unproven is **fidelity to your
production schema**, which only your branch database can settle — and that is
cheaper now, because a failure there is much more likely to be a missing column
in the clone than a bug in the migration.

## Two bugs this shook out

1. `scripts/branch-db/00-preflight.sql` counted `public.menu_items`, which does
   not exist — the table is `public.items`. The preflight would have stopped your
   first run with `relation "public.menu_items" does not exist`. Fixed.
2. The preflight's own header promised "four empty result sets" while printing
   three result tables plus a count. Cosmetic, corrected in the same file.

Neither would have been found by reading. That is the argument for running SQL
before asking somebody else to run it.
