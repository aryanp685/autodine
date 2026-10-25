# L1 — "throttle → held order, never a refusal": exact semantics

Status: **proposal for approval. Nothing implemented. No limit changed. No SQL
written.** The only existing artifact is migration `20261028000900`, which is
unapplied and which this document proposes to amend.

---

## 1. What happens today, exactly

`open_table_session(p_public_token, p_ip_hash)` in
`supabase/migrations/20261028000900_guest_scan_confirm.sql`:

| step | behaviour |
| --- | --- |
| 1 | token shape check → `unreadable` |
| 2 | card exists and not revoked → else `revoked` |
| 3 | restaurant mode is `code` → `code` (scan cannot mint) |
| 4 | table active → else `revoked` |
| 5 | restaurant active and writable → else `notserving` |
| 6 | a published menu exists → else `nomenu` |
| 7 | **10 successful openings per card per rolling hour** → `limited` |
| 8 | **20 successful openings per address per rolling hour** → `limited` |
| 9 | else mint (59 min, SHA-256 stored) and record one row in `table_session_opens` → `opened` |

`app/t/[token]/route.ts` treats every non-`opened` status the same way: it
redirects to the menu and writes no cookie. So a `limited` guest gets:

- a readable menu,
- a cart they can fill (localStorage, `lib/cart-storage.ts`),
- and, at submit, `place_public_order` refuses because there is no session
  token. In `code` mode the guest is sent to the six-digit form, which is the
  correct ending. In `scan` / `scan_confirm` **there is no code to enter**, so
  the guest is sent to a screen that cannot help them, with the cart intact but
  the order impossible. That is the defect.

Two further facts that make it worse than it looks:

1. **Every scan counts, including reloads.** Opening `/t/<token>` again — a
   refresh, a Back onto the URL, a second tab, a phone waking up — mints another
   session and spends another opening. A normal guest can spend three or four
   without doing anything unusual.
2. **A photographed card can spend the budget in ten requests**, and then the
   real table is locked out for up to an hour. That is a cheap, unauthenticated
   denial of service against one table.

## 2. The rule L1 is built on

> A scan must never cost the guest their cart, and it must never send them to
> ask for a code. When a table looks abusive, the cost lands on **staff
> confidence** (one tap to vouch) — not on the guest's ability to order.

Three cases, and the guest never sees a dead end in any of them.

### Case A — the guest already has a live session (the common case)

`open_table_session` gains a third parameter, `p_session_token` — the cookie the
browser is already carrying. If that token is valid **for this same card,
restaurant and unexpired table**, the function returns:

```
status = 'reused', session_token = null, expires_at = <the existing expiry>
```

- **No new row** in `table_verification_sessions`.
- **No increment** in `table_session_opens`.
- The route keeps the cookie it already had. Nothing is written.

This alone removes the false positives: reloads, Back/Forward, a second tab and
a locked phone stop consuming the budget. It also cannot be abused — reusing a
session mints nothing, and a token from another card or another restaurant is
rejected (case C fallback).

### Case B — no live session, budget spent → **held**, not refused

Over 10/hour per card (or 20/hour per address), and the card still looks
legitimate, the function mints a session **flagged `hold_orders = true`**:

```sql
alter table public.table_verification_sessions
  add column if not exists hold_orders boolean not null default false;
```

- A session is minted and recorded exactly as normal (so the pressure is still
  counted, and the throttle still bites for the next caller).
- `stamp_guest_verification` writes `hold_required = true` on every order of
  that sitting:

  ```sql
  v_held := v_session_hold_orders                                  -- L1
         or (v_mode = 'scan_confirm' and not exists (…confirmed…));
  ```

- The guest orders normally. The ticket appears on the kitchen board in the
  **"Waiting for the floor"** strip — the exact card that already exists for
  `scan_confirm`'s first ticket. One tap accepts the sitting.
- `confirm_table_orders` additionally clears the flag:
  `update table_verification_sessions set hold_orders = false where id = …`.
  A human has vouched, so later orders in that sitting flow — same "one tap per
  sitting" rule the mode already promises.
- The guest's status page says *"waiting for the restaurant to confirm your
  table"*, never anything about a code.

**Why held instead of refused:** the attacker's ten requests stop bricking the
table. The table can still eat; the floor is told that this table looked
unusual, in the one place staff already look.

### Case C — held budget also spent → a bounded stop, with the cart kept

Held mints are themselves capped (**6/hour per card**). Beyond that:

```
status = 'limited', retry_after = <seconds until the oldest opening in the
                                    window falls out>
```

- No session is minted, nothing is recorded.
- The menu stays fully readable, the cart stays in localStorage.
- At checkout the guest is told, in one sentence: *"This table has been scanned
  unusually often in the last hour, so ordering is paused for about N minutes.
  Your cart is safe — try again then, or order with staff."* — and staff can
  take the order at the counter, which is a normal path, not a code.

This is the only branch where a guest cannot order, it is reachable only by
traffic that has already spent 10 openings and 6 held mints on one card inside
an hour, and it is time-bounded and explained. In a real restaurant it should
never occur; if it does, it means somebody is hammering a photographed card,
which is exactly when refusing is correct.

## 3. What this does **not** change

- **Limits stay at 10/card and 20/address.** This proposal deliberately does not
  raise them. The legitimate-busy-table problem is solved by reuse (case A) and
  by held (case B), not by a bigger number. That also keeps the abuse surface
  exactly where it is today.
- **No order can bypass verification.** `placed_public_order` still refuses
  without a session; held orders are *less* trusted, not more.
- **No unverified session becomes free.** `hold_required` is written once, at
  insert, and never recomputed, so changing the restaurant's mode later cannot
  release a ticket that was held.
- **No rotating code is exposed** anywhere, and nothing new is granted to `anon`
  beyond `open_table_session`, which already exists in the unapplied migration.
- **No paid infrastructure**, no scheduler, no external rate limiter.

## 4. Order integrity and idempotency

| risk | how it is closed |
| --- | --- |
| a retried submit writes two orders | unchanged: `guest_token` replay returns the existing code |
| a retried submit flips a held order to unheld | `stamp_guest_verification` only updates rows where `table_session_id is null`, so the first stamp wins |
| a held ticket is "confirmed" twice | `confirmed_at is null` in the UPDATE predicate → 0 rows, reported as already done |
| a session from another table is reused | the reuse path validates hash **and** restaurant **and** table **and** card, and returns nothing otherwise |
| confirming is open to anyone | `auth.uid()` + membership role + `restaurant_can_write`, unchanged |
| a rejected sitting keeps ringing the board | `reject_table_orders` cancels the sitting's held tickets in one statement, unchanged |
| prices are trusted from the client | unchanged: recomputed server-side on every order |
| the guest loses their cart while throttled | nothing server-side touches localStorage; the cart is keyed by slug and survives |

One new boundary to be careful about: `confirm_table_orders` now writes to
`table_verification_sessions`. That table is not currently writable by
`authenticated`; the function is `security definer`, so it must keep its
`search_path` pin and its explicit `revoke`/`grant` exactly as the existing
functions do. No policy is added to the table.

## 5. Tests that must exist before this ships

Runnable **today**, without a database (unit, vitest):

1. `decideScanOutcome(status)` — a pure function extracted out of the route:
   `opened` → set cookie; `reused` → keep cookie, no write; `held` → set cookie;
   `limited` → no cookie, plus the sentence and the retry time; `code` → no
   cookie, send to the code form. This is the mapping that today silently
   swallows three different meanings.
2. Checkout copy for a held session contains "waiting for the restaurant" and
   **never** the code sentence.
3. A held session's status page does not claim "sent to the kitchen".

Requires a **branch database** (SQL), six checks:

4. Six scans + two re-scans carrying the cookie → `6 × opened`, `2 × reused`,
   zero `held`, zero `limited`, and exactly 6 rows in `table_session_opens`.
5. Eleventh scan with no cookie → `held`; the order it places has
   `hold_required = true`; the kitchen held query returns it.
6. Staff confirm on that sitting → ticket confirmed, `hold_orders` cleared, the
   next order in the same session is **not** held.
7. Held budget spent → `limited` with `retry_after > 0`, zero new session rows.
8. Reuse with a token from another card / expired / revoked → **not** `reused`;
   falls through to counting; never returns another table's session.
9. Abuse shape: 100 scans from one address across three cards → every status is
   from the closed set, rows created ≤ 3 × (10 + 6), no exception raised.
10. Regression: a non-member calling `confirm_table_orders` gets `P0001` and
    changes zero rows; a `code`-mode restaurant still returns `code`.

## 6. Cost and risk

- **Schema:** one additive column, default false → existing sessions are
  unaffected and the app keeps working if it is deployed before the SQL.
- **Functions:** `open_table_session` (new parameter, new statuses),
  `stamp_guest_verification` (one condition), `confirm_table_orders` (one extra
  update). No drops.
- **Behaviour change visible to a guest:** none in the happy path; in the
  throttled path, "you cannot order" becomes "your order waits for a tap".
- **Behaviour change visible to staff:** the board can show a held card for a
  table nobody expected — that is the point, and it is the same card they
  already know how to press.
- **What must be decided before writing it:** whether Case C should exist at all
  (a pure "always hold" design removes the only refusal, at the cost of letting a
  photographed card put unlimited held tickets in front of staff). My
  recommendation is to keep Case C at 6/hour, because staff attention is a real
  resource that an attacker should not be able to spend for free.
