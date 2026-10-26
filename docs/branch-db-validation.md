# Branch-database validation — the exact sequence, and who runs which part

**Status: nothing has been applied. PR #113 is open and unmerged, production is
unchanged, and migration `20261028000900` is still unapplied.** This document is
preparation only.

## 0. Who runs what — measured, not assumed

This sandbox has outbound access to `github.com`, `codeload.github.com`,
`api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`, and
nothing else. Measured just now: `curl https://github.com` → **200**,
`curl https://supabase.com` → **000** (no route). There is no Postgres binary and
no browser here either.

Consequence, stated plainly: **every step that touches a database is yours to
run.** Approval alone would not let me execute it — I cannot reach the project.
No credential is needed from you, and none should be pasted into this chat.

| # | step | who | why |
| --- | --- | --- | --- |
| S0 | create the branch project | **you** | dashboard access |
| S1 | clone the live schema into it | **you** | needs both connection strings |
| S2 | preflight: identity, empty-clone guard, prerequisites | **you** | touches the DB |
| S3 | capture rollback artefacts (`02-capture-rollback.sql` + schema dump) | **you** | touches the DB |
| S4 | **apply the migration** | **you**, after your explicit approval | touches the DB |
| S5 | "after" record (`03-verify-after.sql`) | **you** | touches the DB |
| S6 | the 10 `PASS` blocks (`06_scan_limits.sql`) | **you** | touches the DB |
| S7 | the browser throttle test | **you** | needs the app + a browser |
| S8 | pause or delete the branch | **you** | dashboard access |

What the sandbox has done, and can do, without a database:

| check | how | result |
| --- | --- | --- |
| the four SQL files in `scripts/branch-db/` are syntactically valid Postgres | parsed with `pgsql-ast-parser` | 4/4 parsed — **parsed, not executed** |
| every object the checks name actually exists in the migration or the known schema | read the migration line by line | consistent; see §5 below |
| `06_scan_limits.sql` still contains all ten blocks and ends in `rollback` | static read | 10 `PASS n` blocks, 1 `rollback` |
| the migration's statement inventory and line ranges | verified against the file (Appendix A) | matches |
| nothing in this round changes application code | `git diff --stat` | docs + `scripts/branch-db/` only |
| unit suite and hermetic E2E still pass | `vitest run`, CI, E2E workflow | 95 files / 1257 tests; E2E 9/9 (previous run, unchanged by this round) |
| the migration actually executes | PostgreSQL 16.2 built from the repo's 26 migrations + a scaffold | **applied cleanly**; see `docs/validation-local-pg-2026-10-26.md` |
| the ten `PASS` blocks actually pass | `06_scan_limits.sql` on that database | **PASS 1 … 10**, verbatim in the same file |
| a database-backed throttle, through the real code | `app/menu/throttle-db.integration.test.tsx` | **3/3 passed** on that database |

## 1. Before any SQL: is this the right database?

Three questions, in this order. If any answer is wrong, stop — do not proceed to
S4.

### 1.1 The human check (only you can do it)

Open the branch project in the dashboard and keep the tab visible. S2 prints the
database name, the role and the server address. Compare the project ref in that
tab with the ref in the connection string you are about to use. They must be the
same, and that ref must **not** be the production one.

### 1.2 The mechanical guard

A branch is created from a schema dump, so every table starts empty. Production
has real orders. S2 prints:

```sql
select (select count(*) from public.orders)      as orders,
       (select count(*) from public.restaurants) as restaurants,
       (select count(*) from public.memberships) as memberships,
       (select count(*) from public.menu_items)  as menu_items;
```

**Expect `0, 0, 0, 0`.** Non-zero `orders` before you have applied anything means
this is not a fresh clone. Stop.

### 1.3 Backup and rollback artefacts — before the migration

Two artefacts, both captured in S3, both before S4:

```bash
# (a) the whole branch shape, so it can be restored to this exact point
pg_dump --schema-only --no-owner --no-privileges "$BRANCH_DATABASE_URL" \
  > branch-schema-before-$(date +%Y%m%d-%H%M).sql

# (b) the exact bodies of the two functions the migration REPLACES, plus the
#     current column lists. This is the surgical rollback.
psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f scripts/branch-db/02-capture-rollback.sql \
     > branch-rollback-$(date +%Y%m%d-%H%M).sql
```

(b) matters because Tier 3 of the rollback (`docs/migration-20261028000900-review.md`
§5) drops the new columns — which breaks the order path unless the pre-migration
`place_public_order` and `get_public_order` are restored first. Those exact
bodies are what (b) prints.

There is no data to back up: the clone is empty, and the runbook has you seed a
demo restaurant only *after* the migration is verified.

## 2. The sequence

Run everything from the repository root, with `$BRANCH_DATABASE_URL` set to the
branch. `$PRODUCTION_DATABASE_URL` is used exactly once (S1, read-only) and is
never needed again.

### S0 — create the branch project (you)

Supabase dashboard → **New project** (free tier) → region closest to you → note
the connection string as `$BRANCH_DATABASE_URL`. Do not use the production
project. Do not paste either string into this chat.

### S1 — clone the live schema (you)

```bash
pg_dump --schema-only --no-owner --no-privileges "$PRODUCTION_DATABASE_URL" \
  | psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1
```

Then prove the clone is faithful — run these on **both** databases and compare:

```sql
select count(*) from pg_proc where pronamespace = 'public'::regnamespace;
select count(*) from information_schema.tables where table_schema = 'public';
```

A handful of difference in `pg_proc` is expected (Supabase's own helpers differ
per project). A difference of dozens means the dump missed objects created
outside migrations — stop and say so.

> A branch made by `supabase/migrations` alone will fail before it reaches this
> migration: `table_qr_codes`, `table_verification_sessions` and
> `qr_verification_attempts` are created by no migration in this repository.

### S2 — preflight (you)

```bash
psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f scripts/branch-db/00-preflight.sql
```

Expected: one identity row, one counts row of `0, 0, 0, 0`, one booleans row that
is `t` throughout, and **three empty result sets** (the migration's columns,
functions and table must not exist yet).

### S3 — rollback artefacts (you)

§1.3 above. Keep both files. Paste nothing secret; the function definitions are
not secret, the connection string is.

### S4 — apply the migration (you, only after approval)

```bash
psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -f supabase/migrations/20261028000900_guest_scan_confirm.sql
```

`-1` runs the whole file in one transaction. The file has no `begin`/`commit` of
its own, so the Supabase SQL editor would apply it statement by statement and
could leave half of it behind (review doc §2.4).

Expected: only `ALTER TABLE`, `CREATE INDEX`, `CREATE TABLE`, `CREATE FUNCTION`,
`COMMENT`, `REVOKE`, `GRANT` output, in that rough order, and no `ERROR`.

### S5 — the "after" record (you)

```bash
psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f scripts/branch-db/03-verify-after.sql
```

Expected, against review doc §4.2:

| section | expected |
| --- | --- |
| 1 | `guest_verification_mode` text NOT NULL default `'code'`; `hold_required` boolean NOT NULL default false; `confirmed_at`, `confirmed_by`, `table_session_id` nullable |
| 2 | 4 rows: `orders_held_idx`, `orders_session_idx`, `table_session_opens_card_idx`, `table_session_opens_ip_idx` |
| 3 | `rls_enabled = t`, `policies = 0`, zero grants to `anon`/`authenticated` |
| 4 | 6 functions, every `security_definer = t`, `config` containing `search_path=public` |
| 5 | `t, f, t, f` — anon may open a session, may not confirm one, anon may not call `stamp_guest_verification` |
| 6 | `orders_total = 0` (an empty clone) |

### S6 — behaviour: the ten PASS blocks (you)

```bash
psql "$BRANCH_DATABASE_URL" -v ON_ERROR_STOP=1 \
     -f supabase/checks/06_scan_limits.sql
```

Ten `PASS n:` notices, one `rollback` at the end, nothing kept. `PASS 9` should
report `retry column present=false` — that is today's truth, and it is what the
screens say "a short while" for.

### S7 — the browser throttle test (you, optional but it is the only end-to-end proof)

Prerequisites: a restaurant on the branch with a published menu, a table (the
trigger creates the card), and the mode set to `scan`:

```sql
update public.restaurants set guest_verification_mode = 'scan' where slug = '<your slug>';
select q.public_token from public.table_qr_codes q
  join public.restaurants r on r.id = q.restaurant_id
 where r.slug = '<your slug>' and q.revoked_at is null;
```

Then build the app **with the branch's environment**, because `NEXT_PUBLIC_*`
values are inlined at build time:

```bash
NEXT_PUBLIC_SUPABASE_URL=<branch url> \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<branch publishable key> \
SUPABASE_SECRET_KEY=<branch secret key> \
npm run build
NEXT_PUBLIC_SUPABASE_URL=<branch url> npx next start -H 127.0.0.1 -p 3100
```

and in another shell:

```bash
E2E_BASE_URL=http://127.0.0.1:3100 \
E2E_QR_TOKEN=<the public_token from above> \
npx playwright test --config playwright.integration.config.ts
```

Use `.env.local` for the keys if you prefer; never commit it, never use
production keys.

**Discovery vs execution.** The sandbox has run discovery only:

```
npx playwright test --config playwright.integration.config.ts --list
  [throttle] › throttle.spec.ts:40:7 › a card scanned too often › is refused by the database, and the guest is told on the menu itself
  [throttle] › throttle.spec.ts:89:7 › a card scanned too often › carries no retry number unless the database returned one
  Total: 2 tests in 1 file
```

That proves the spec parses and is wired to the right files. **It is not
execution**, and no result from it may be quoted as a pass.

### S8 — leave it or throw it away (you)

Pause or delete the branch project. Production is unaffected either way.

## 3. The approval gate

Nothing above happens until you approve, in these words or equivalent:

> Apply `supabase/migrations/20261028000900_guest_scan_confirm.sql` to branch
> project `<ref>` (not production), after S2 preflight and S3 artefacts.

That approval covers **S4 on that branch database only**. It does not cover
production, merging PR #113, or deploying. Those stay separate approvals.

Because I cannot reach the project, the practical form is: you approve the step,
you run S4, and paste the outputs of S2/S4/S5/S6 here. I then read them against
§4 of the review doc and report what actually happened.

## 4. Keeping the three result sets apart

Do not average these together; they answer different questions.

| set | how it runs | status after this round |
| --- | --- | --- |
| **A. Unit + hermetic E2E** (application logic) | `npm test`, CI, E2E workflow | **run**: 95 files / 1257 tests; CI success; E2E 9 passed / 0 failed. Unchanged by this round |
| **B. Migration validation** (schema + SQL behaviour) | S2/S4/S5/S6 on the branch | **not run**: no database, none applied |
| **C. Database-backed throttling** (real browser, real refusal) | S7 | **discovery only** (`--list`); never executed |

A result in C does not validate B, and neither of them says anything about A.

## 5. What the checks are reading, verified without a database

Every object the four SQL files name exists either in the migration or in the
schema the migration itself depends on:

| file | touches | exists because |
| --- | --- | --- |
| `00-preflight.sql` | `orders`, `restaurants`, `memberships`, `menu_items`, `table_qr_codes`, `table_verification_sessions`, `pg_proc`, `information_schema` | live schema (cloned); catalog views are built in |
| `01-verify-before.sql` | same catalogs only | — |
| `02-capture-rollback.sql` | `pg_get_functiondef`, `place_public_order`, `get_public_order`, three tables | both functions already exist on the clone (created by `20261027000900` and its predecessor) |
| `03-verify-after.sql` | the six functions and four indexes the migration creates, plus the catalogs | migration §1–§8 |
| `06_scan_limits.sql` | `open_table_session`, `place_public_order`, `confirm_table_orders`, `orders`, `table_session_opens`, `table_verification_sessions`, `restaurants` | migration; §1 requires them, so it is run only after S4 |

## 6. If something fails

Stop at the failing step, keep the output, and do not "fix forward" on
production. What the likely failures mean is in
`docs/migration-20261028000900-review.md` §9. The short version:

| failure | meaning | action |
| --- | --- | --- |
| S2 counts non-zero | not a fresh clone — possibly production | **stop**, disconnect, re-check the project ref |
| S1/S2 missing `table_qr_codes` | clone built from migrations, not from a dump | re-dump from production |
| S4 fails part-way | the transaction rolled back; nothing is half-applied | fix the cause, re-run S4 — every statement is repeatable |
| S5 section 4 shows `security_definer = f` | function grants/definer wrong | **stop**, do not seed or test; report |
| any `FAIL n` in S6 | a claim in `docs/scan-limit-l1.md` is false | **stop**, report the block number and message; do not proceed to S7 |
| S7 fails at the first scan | the restaurant is not on `scan` mode, or the card is dead | check the mode and `revoked_at`; this is a setup problem, not a throttle problem |

## 7. Results log — paste this back

```
project ref:            __________   (branch, not production)
S1 pg_proc count:       production ____ / branch ____
S2 identity + counts:   <output>
S2 booleans:            all t / not all t
S3 artefacts saved:     branch-schema-before-____.sql, branch-rollback-____.sql
S4 apply:               success / error: ______
S5 sections 1-6:        <output>
S6 PASS lines:          PASS 1..10 / fails: ______
S7 discovery:           (already known) 2 tests
S7 execution:           passed / failed: ______
```
