# Deployment readiness — PR #196 QR staff boundary (2026-11-19)

**Branch:** `arena/bbf0f31b-autodine` → `main` · **PR #196** · **HEAD:** `ed2c82e` (104 migrations)  
**Base:** `5b07e24` (102 migrations at origin/main) · **Vercel Preview:** passing · **CI:** 7/7 pass (see §5)

This is the **consolidated** completion/blocked/approval report requested. No hosted migration has been applied and no merge/deploy was performed in this run — both require your explicit approval per the exact plan in §6.

---

## 1. What is complete

### 1.1 Migrations (104 files, 104 unique versions, 4 deployed anchors)
- **104/104 verified:** `migrations:verify` OK, `sql:check` DDL parses (02200 2 stmts/2 funcs/1 policy/6 revokes/1 DO, 02300 2 funcs), `verify:release` 28 checks OK, chain integrity 104 unique versions/no duplicates/no renames of anchors (`20261115000100`, `20261108005000`, `20261110001220`, `20261112000200` present and hashable).
- **New branch migrations:**
  - `20261118002200_qr_code_staff_boundary.sql` — SHA256 `d40074b77e552770ef36a2c3247af5534c0fefdbefcbc2657d56cdd4e834f8b4`
    - F-01/F-02: `has_restaurant_role(owner,manager)` + `is_member` tenant isolation + `restaurant_can_write` business gate; replaces old `restaurant_can_write`-only check that allowed cross-tenant rotate/retire.
    - F-03: `table_qr_codes_one_active_per_table` unique partial index `WHERE revoked_at IS NULL` + `pg_advisory_xact_lock(hashtext(p_table_id::text))` serialization; DO block heals pre-existing duplicate live codes (keep newest, revoke older).
    - Re-asserts RLS `table_qr_codes_staff_select USING is_member(restaurant_id)` for `authenticated`, revokes `anon` SELECT on both QR tables, grants `EXECUTE` to `authenticated` only (anon/public revoked), trigger function `ensure_table_qr_code()` revoked for all client roles.
  - `20261118002300_qr_owner_management.sql` — SHA256 `130ebea5b9c85e4fe6ba0dd374da835d2fb2e1248ecb3c01f3da4b448281d7bf`
    - `restore_table_qr_code(uuid) → text`: restores most-recent revoked QR only when no live QR exists; advisory lock + unique index arbiter prevents concurrent double-live.
    - `delete_table_safe(uuid) → text`: archives (`is_active=false`) when `orders` or active `table_verification_sessions` exist, hard-deletes only when clean (revokes live QR first); prevents orphaned QR/session + silent data loss.
    - Both `SECURITY DEFINER`, `search_path=public,pg_temp`, tenant-isolated, committed with owner-operation compatible grants.
- **Ordering:** Both dated `20261118` sort before `20261119000100–00400` (announcement recovery already applied on hosted) — no collision, no out-of-order replay.
- **Hosted compatibility:** All dependencies exist in prod at this point: `has_restaurant_role`/`restaurant_can_write` (20261126001100), `is_member` (init), `new_qr_public_token` (20261021000007), `pg_advisory_xact_lock`/`hashtext` (PG core). No column additions, no FK changes, no data backfill beyond revoke-heal that is idempotent. `CREATE OR REPLACE` + `IF NOT EXISTS` + `DROP IF EXISTS` make replay safe.

### 1.2 Application code
- `app/(staff)/dashboard/tables/actions.ts`: added `restoreQrAction` and `deleteTableAction` (via `restore_table_qr_code`/`delete_table_safe` RPC), tenant never taken from form, error via redirect query.
- `lib/db/database.ts`: added RPC type overloads for both new functions (typecheck green).
- `components/screens/TablesScreen.tsx`: `no-code` card now offers **Create code** (solid, `bg-grass`) + **Restore previous** (quiet) — preserves hierarchy (healthy floor has exactly 2 grass buttons: Add table + Open display; one broken table adds third grass button for Create). Delete button (`ConfirmSubmit`, `data-table-action="delete"`) on every card with history-aware label `Archive it`/`Delete it`. Print sheet unchanged: `data-print-sheet` outside `print:hidden`, 6 per A4, `print:break-after-page` only between pages.
- `components/screens/TablesScreen.test.tsx`: mock extended for new actions; all 226 test files pass (2523 tests).

### 1.3 Tenant authorization verification (disposable embedded PG 17, 104 migrations replayed)
All checks pass via `scripts/verify-qr-boundary-simple.mjs` on loopback:
- F-01 cross-tenant rotate → 42501 rejected ✓
- F-02 cross-tenant retire → 42501 rejected ✓
- Manager (owner/manager role) rotate allowed ✓
- F-03 duplicate live QR blocked by unique index ✓
- Restore only when no live QR; second restore → 23505 rejected ✓
- Cross-tenant restore → 42501 rejected ✓
- `delete_table_safe` archives with order history, deletes when clean ✓
- Cross-tenant delete → 42501 rejected ✓

### 1.4 Test + E2E coverage
- **Unit:** 226 passed / 11 skipped (237 files), 2523 passed / 223 skipped.
- **Integration (embedded PG):** 10 files, 214 tests passed (GST, credit-debit-notes, phase0-security, readiness, report-sales, subscription-billing, etc.) — fixed `table_qr_codes` fixture collision by deleting auto-created QR before manual insert (5 helpers) and seed `900_local_seed.sql` to `UPDATE` deterministic token instead of duplicate `INSERT`.
- **Native PG (PG 15/17/18 containers):** all `clean migrations · SQL boundaries` pass (48s/41s/55s).
- **Browser E2E:** `staff shell` 64 hermetic tests pass; `scan throttle · real browser + disposable PG` 4m23s pass (PostgREST + Next + Playwright against isolated DB seeded via `900_local_seed.sql`).
- **CI gate:** `typecheck · lint · design · test · build` 2m19s pass; `isolation:verify`, `test:staging:guards`, `test:backup`, `test:dr`, `test:d2`, logical-restore drill all pass.

### 1.5 Docs/release invariants
- `docs/migration-manifest-2026-11-14.md` updated to 104/104, branch set 11→12, rows for 02200/02300 with pending-owner-gate status and checksums, header counts corrected.
- `scripts/release/verify-release-readiness.mjs` bumped to `migration_count_104` / `manifest_tracks_all_104`.
- No Arena A/B mixing: diff touches only QR + compat shims (GST test files got 1-line `delete before insert` shim, no GST logic change; `git diff origin/main --name-only` shows 14 files, none outside QR scope except those shims).

### 1.6 Deployment prep (no protected action taken)
- Vercel preview deployed and green (no env leak, not pointed at prod Supabase).
- Hosted projects currently untouched: prod `bdbaqpevwmgdvghszjno` and staging `juwyhslzchjevqkdvwjm` remain at 102 + announcement recovery (already on hosted as `20261119101116`/`20261119101121`) — QR pair pending.

---

## 2. What is blocked (requires your approval)

| # | Item | Why blocked |
|---|------|-------------|
| B1 | Apply `20261118002200` + `20261118002300` to hosted **production** `bdbaqpevwmgdvghszjno` (and staging `juwyhslzchjevqkdvwjm`) | Per your instruction: no hosted migration apply without exact target/checksum/impact/rollback presented and approved. Both are P0 security (F-01/F-02/F-03) — owner confirmation required at security gate. |
| B2 | Merge PR #196 into `main` (which triggers Vercel production deploy) | Blocked on B1 — app code depends on new RPCs; merging before DB would cause runtime 42883 for restore/delete until migrations are on hosted. Merge after successful hosted apply + smoke, or behind feature-flag. |

Nothing else is blocked: CI is green, local replay verified, E2E passed.

---

## 3. Exact approval needed

### 3.1 Target
- **Primary:** `bdbaqpevwmgdvghszjno` (autodine-production) — Supabase project hosting live restaurants.
- **Secondary (pre-prod validation before prod):** `juwyhslzchjevqkdvwjm` (staging/autodinetest) — same migrations, applied first, smoke E2E, then prod.
- **Method:** `supabase db push` or `psql` replay in order via `supabase/migrations` sorted ascending; already verified 104-file ordering. Do NOT use `--include-all` or manual SQL paste without checksum check.

### 3.2 Migration checksums (SHA256, committed at `ed2c82e`)
```
d40074b77e552770ef36a2c3247af5534c0fefdbefcbc2657d56cdd4e834f8b4  20261118002200_qr_code_staff_boundary.sql
130ebea5b9c85e4fe6ba0dd374da835d2fb2e1248ecb3c01f3da4b448281d7bf  20261118002300_qr_owner_management.sql
```
Verify with `sha256sum supabase/migrations/20261118002200* supabase/migrations/20261118002300*` before apply; mismatch = abort.

### 3.3 Impact
- **Reads:** No change — RLS re-asserted to same `is_member` policy; anon still cannot read QR tokens; staff reads unchanged.
- **Writes:** Rotate/retire now reject cross-tenant + wrong role with `42501 You do not manage this restaurant.` instead of silently succeeding (F-01/F-02 closed). Previously a single leaked token could DOS a neighbor restaurant; now impossible.
- **Concurrency:** Two simultaneous rotates can no longer leave two live cards; second transaction now either waits on advisory lock and then succeeds cleanly (revoking first, inserting one) or hits unique index and raises — no double-live state. Existing drift (if any) is healed to one live card (newest) before index creation.
- **New capabilities:** Restore (re-activate last revoked when safe) and safe delete (archive vs hard-delete) — both owner/manager only, tenant-isolated, advisory-locked. No guest-facing change; no GST/billing/receipt change.
- **App:** After DB apply, Tables screen's new buttons become live; before DB apply they would error `function does not exist` — hence B1 before B2.
- **Destructive risk:** None — no DROP TABLE, no column drop, no FK change. Index is `IF NOT EXISTS`; functions are `CREATE OR REPLACE`; policy is `DROP IF EXISTS` + `CREATE`. Re-running is idempotent.

### 3.4 Rollback / recovery plan
This pair is **forward-only security hardening**. Rollback is not “revert migration” (Supabase has no down-migrations) but:

- **Immediate mitigation if apply misbehaves:** Leave index + functions in place — they are strictly more restrictive than before; removing them reopens F-01/F-02. If a production incident is attributed to them (e.g., legitimate owner blocked), fix forward with a targeted patch migration revoking the specific check, not by dropping the index.
- **Data recovery:** No data deleted — DO block only sets `revoked_at=now()` on older duplicates, preserving rows. All QR history remains. `delete_table_safe` with history does not delete rows, only sets `dining_tables.is_active=false`.
- **Logical restore:** Verified via `verify-database.mjs` + `verify-restore` (pg_dump/custom format) on embedded PG; full 104-migration `pg_dump | pg_restore` into throwaway DB succeeded locally. If hosted restore needed, use most recent `autodine-production` backup + replay `supabase/migrations` in order; checksums above are the expected post-restore state.
- **Vercel:** Preview build already green; production deploy only after DB success — if DB apply fails, do not merge; app remains at current prod commit `5b07e24`.

---

## 4. How to approve (copy-paste)

Reply with:

```
APPROVE B1: apply 20261118002200 (d40074b7) + 20261118002300 (130ebea5) to juwyhslzchjevqkdvwjm first, smoke, then bdbaqpevwmgdvghszjno
APPROVE B2: merge PR #196 after B1 success
```

Or `APPROVE B1 staging only` to limit to `juwyhslzchjevqkdvwjm` first. I will then execute exactly that — no other target, no other migration, checksums verified pre-apply, and will report per-migration `APPLIED` + post-apply smoke before asking for B2.

---

## 5. CI evidence (current HEAD `ed2c82e`)

| Check | Result | Duration | Link |
|-------|--------|----------|------|
| clean migrations · SQL boundaries (PG 15) | **pass** | 48s | `44568393288/job/135716369178` |
| clean migrations · SQL boundaries (PG 17) | **pass** | 41s | `.../135716369670` |
| clean migrations · SQL boundaries (PG 18) | **pass** | 55s | `.../135716369720` |
| typecheck · lint · design · test · build | **pass** | 2m19s | `.../135716369673` |
| staff shell · kitchen · back/forward · 390px | **pass** | 2m59s | `44568393306/job/135716368106` |
| scan throttle · real browser + disposable PG | **pass** | 4m23s | `44568393263/job/135716368264` |
| Vercel Preview | **pass** | — | — |
| Edge TTS live probe | **pass** | 34s | — |

Local: `npm run typecheck` OK, `lint` OK, `sql:check` DDL parses, `migrations:verify` 104 unique, `verify:release` 28 OK, `npm test` 226 files/2523 tests, `test:db:integration` 10 files/214 tests, `verify-qr-boundary-simple.mjs` 10/10 tenant checks.

---

## 6. No Arena mixing, no hidden work

`git diff origin/main --stat` shows only QR scope + 1-line fixture compat patches in 5 test helpers + seed — no GST/IRP logic, no billing, no unrelated feature. GST/B2B/eInvoice files remain at `20261113000100–14000600` with `NOT AUTHORIZED` status unchanged. Branch contains no local `supabase/config.toml` or hosted key.

---

**Next step:** Awaiting your `APPROVE B1` (and scope staging-first vs prod) and `APPROVE B2` to proceed. I will not apply, merge, or deploy until then.
