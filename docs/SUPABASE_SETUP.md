# Connecting Supabase — step by step

**Read this top to bottom once before you start.** Every step says what to expect, so you can tell the difference between "working" and "quietly broken".

Total time: about **20 minutes**.

You need: a GitHub account (you have one) and an email. **No card, no payment — the free tier is enough.**

---

## 1. Create the project (3 min)

1. Go to **[supabase.com](https://supabase.com)** → **Start your project** → sign in with GitHub.
2. **New project**. Fill in:
   - **Name:** `autodine`
   - **Database Password:** generate a strong one. **Save it now** — it cannot be recovered later, and you need it for `DATABASE_URL`.
   - **Region:** **South Asia (Mumbai) — `ap-south-1`**. This matters. Measured from India, Mumbai answers a hot query in ~5 ms; the next-best option (Singapore) is ~58 ms. A kitchen board feels that difference.
3. Wait ~2 minutes for provisioning.

> **The free tier pauses your database after 7 days with no activity.** Once we're past the pilot I'll add a scheduled ping so this never surprises you. Until then: if the app suddenly can't load, check the project dashboard for a "paused" banner and click restore.

---

## 2. Collect your keys (1 min)

**Project Settings → API.** Copy these three:

| Value | Where | Safe to expose? |
|---|---|---|
| **Project URL** | "Project URL" | Yes |
| **anon / public key** | Project API keys → `anon` `public` | Yes — protected by RLS |
| **service_role key** | Project API keys → `service_role` | **NO. Bypasses RLS entirely.** |

Also: **Project Settings → Database → Connection string → URI** for `DATABASE_URL`. Replace `[YOUR-PASSWORD]` with the password from step 1.

---

## 3. Put them in `.env.local` (2 min)

**Create the file yourself** in the repo root. Do not paste keys into chat.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.abcdefgh.supabase.co:5432/postgres
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

> **This file is for your machine only.** It is gitignored, so it never reaches GitHub and Vercel never sees it. The deployed site gets its keys separately, in step 8. Doing only step 3 and skipping step 8 is the single most common way to end up with a site that works locally and shows "database is not connected" in production.

`.env.local` is already in `.gitignore` — verify with `git status` that it does **not** appear as a change. If it does, stop and tell me.

`NEXT_PUBLIC_` values are compiled into the browser bundle. That is fine for the URL and anon key. It is **never** fine for `SUPABASE_SERVICE_ROLE_KEY`, which is why it has no prefix.

---

## 4. Run the migration (3 min)

**SQL Editor → New query.** Paste the **entire** contents of `supabase/migrations/20261019000001_init.sql` (544 lines).

Easiest way to copy it without hunting around your disk: open it on GitHub, click the **Raw** button, then select-all and copy.

<https://github.com/aryanp685/new/blob/main/supabase/migrations/20261019000001_init.sql>

Click **Run**.

**If it succeeds** you'll see `Success. No rows returned`.

**If it fails**, don't guess — copy the error message and send it to me. Most likely causes, in order:

- `function gen_random_uuid() does not exist` → the pgcrypto extension didn't load. Run `create extension if not exists "pgcrypto";` first, then re-run.
- `type "member_role" already exists` → you ran it twice. See "Starting over" below.
- Anything inside `place_order` → **expected, and important.** I could not execute this migration before you did (no Postgres in my sandbox, no network to Supabase). Tell me the exact error and I'll fix it.

### Verify it actually worked

Run this in the SQL editor:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

You should see **12 tables**: `categories, dining_tables, item_variants, items, memberships, menus, order_items, orders, payments, profiles, qr_tokens, restaurants`.

Then confirm RLS is on:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

**Every row must say `t`.** If any says `f`, tenant isolation is off for that table — tell me immediately.

---

## 5. Seed the demo restaurant (2 min)

**SQL Editor → New query.** Paste the contents of `supabase/seed.sql` (65 lines, already generated — or regenerate locally with `npm run seed:sql`).

Raw copy: <https://github.com/aryanp685/new/blob/main/supabase/seed.sql>

Run it.

This creates the fictional **Saffron & Smoke**, its menu, 12 tables, and a QR token for each. It's idempotent, so running it twice is harmless.

Verify:

```sql
select r.name, count(i.id) as items
from public.restaurants r
left join public.items i on i.restaurant_id = r.id
group by r.name;
```

Expect one row, `Saffron & Smoke`, with ~40 items.

---

## 6. Create your owner login (3 min)

1. **Authentication → Users → Add user → Create new user.**
2. Use your email and a password. Tick **Auto Confirm User** — otherwise you'll be stuck waiting for a confirmation email.
3. After creating, click the user and **copy the User UID** (a uuid).

Now link that user to the restaurant as an owner. **SQL Editor:**

```sql
-- Replace BOTH values.
insert into public.profiles (id, full_name)
values ('PASTE-USER-UID-HERE', 'Your Name');

insert into public.memberships (restaurant_id, user_id, role)
values (
  '00000000-0000-4000-8000-000000000001',
  'PASTE-USER-UID-HERE',
  'owner'
);
```

**This step is the one people forget.** Without a membership row, RLS sees you as a stranger and every dashboard query returns empty — not an error, just nothing. Silent emptiness is the most confusing failure mode in this whole setup.

---

## 7. Prove tenant isolation works (2 min)

Do this once. It is the single most valuable check in this document.

**SQL Editor → New query, and note: the editor runs as the database owner, so it bypasses RLS.** That's why we test differently — paste this, which simulates what an anonymous browser sees:

```sql
-- What an anonymous visitor can see, with RLS applied.
-- Expect: the published menu only. No tables, no tokens, no payments.
set local role anon;
select 'restaurants' as tbl, count(*) from public.restaurants
union all select 'menus',      count(*) from public.menus
union all select 'items',      count(*) from public.items
union all select 'qr_tokens',  count(*) from public.qr_tokens
union all select 'payments',   count(*) from public.payments
union all select 'orders',     count(*) from public.orders;
reset role;
```

**Expected:** `restaurants 1`, `menus 1`, `items ~40`, and **`qr_tokens 0`, `payments 0`, `orders 0`**.

If `qr_tokens` or `payments` return anything other than 0, **RLS is not working** — stop and tell me. That would mean any visitor could read every table code and every payment in the system.

---

## 8. Add the same keys to Vercel (2 min)

The deployed site does **not** get your `.env.local` — Vercel builds straight from GitHub, and `.env.local` is gitignored, so it never leaves your machine. The keys have to be entered in the Vercel dashboard as well.

**Vercel → your project → Settings → Environment Variables.** Add each of these. For each one, tick **Production, Preview, and Development**:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL      (your Vercel URL, e.g. https://new-xxxx.vercel.app)
```

Then **Deployments → the ⋯ menu on the latest deployment → Redeploy**.

Environment variables only affect **new** builds. An existing deployment keeps running with whatever it was built with, so without a redeploy you will see no change at all and conclude the keys are wrong when they are fine.

---

## 9. Tell me

Send me **only** these two things (never the service_role key):

1. Whether migration 0001 ran clean, or the exact error.
2. Whether the tenant-isolation check returned `qr_tokens 0, payments 0, orders 0`.

---

## Starting over

If you need a clean slate, **SQL Editor**:

```sql
drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
```

Then re-run the migration and the seed.

---

## What is deliberately not set up yet

Stated now so nothing surprises you later:

- **No automated backups.** The free tier has none. Backups are a Day-1 item for me.
- **No rate limiting** on `place_order`. An abusive client can spam orders.
- **QR tokens don't rotate automatically yet.** The seed issues tokens valid 7 days.
- **Realtime is not enabled** for the kitchen board — that's Day 2.
- **No `updated_at` trigger** on orders.

Each of these is a follow-up migration, listed in the `KNOWN GAPS` section at the bottom of migration 0001.
