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


---

## 7. The five questions, answered directly

### 7.1 Where is a held order stored?

**In `public.orders`, like every other order.** There is no queue, no side table
and no browser state involved. A held ticket is a normal row that already went
through `place_public_order_core` — priced server-side, table stamped from the
session, `order_items` written — with exactly one difference:

```
hold_required = true      written once, at insert, never recomputed
confirmed_at  = null      nobody has vouched for this sitting yet
confirmed_by  = null
table_session_id = <the sitting>
```

So "held" is a property of an order that exists, not a holding pen. If the
process dies, the database rolls back; if the request succeeds and the browser
closes, the row is still there. Nothing about a held order is provisional.

### 7.2 How is it recovered?

Three ways, all already built:

1. **The board.** `lib/db/kitchen-screen.ts` splits held rows out of the cook
   columns and the "Waiting for the floor" strip renders one card per sitting
   (`components/owner/HeldTableStrip.tsx`). It is the same query the board
   already runs; a held row is simply selected by
   `hold_required and confirmed_at is null`.
2. **`confirm_table_orders(session)`** — one tap, confirms every held ticket in
   that sitting, and (under L1) clears `hold_orders` on the session so later
   orders in the same sitting flow.
3. **`reject_table_orders(session, reason)`** — two taps, cancels the sitting's
   held tickets in one statement and appends the reason to the guest's note.

If nobody acts, the ticket waits. It does not auto-release, because an
auto-released hold is the same as no hold.

### 7.3 Can the kitchen see it?

Yes, and only the floor-facing strip sees it: held tickets never appear in a
cook's column, so nobody starts cooking food for a table that may not exist. The
card names the table, the sitting's total and the time. Rejection and
confirmation are both one tap from that card.

### 7.4 How are duplicate submissions prevented?

Two independent keys, both already in the database:

- **`orders.guest_token`** — generated by the browser before submit and sent in
  the form. `place_public_order` reads it first and returns the existing order
  code; on a unique violation (two requests genuinely at once) it re-reads and
  returns the winner's code. A double-tap therefore produces one order and one
  code, and the second response is a redirect to the same confirmation.
- **`confirmed_at is null` in the UPDATE** — a second Accept, from a second
  tablet or a replayed action, matches zero rows and is reported as "already
  confirmed", not as a second confirmation.

The one thing L1 adds is a **third** guard: `hold_required` is written only when
`table_session_id is null`, so a replayed `stamp_guest_verification` cannot turn
an accepted order back into a held one, and cannot turn a held one loose.

### 7.5 Throttling verification vs throttling order submission

These are different questions and the code must not merge them:

| | verification (a scan minting a session) | order submission (`place_public_order`) |
| --- | --- | --- |
| what it costs | one session row + one attempt row | an order, its lines, a kitchen ticket, money |
| what it protects | session minting from a photographed card | nothing — it is the thing being protected |
| who is hurt when it refuses | the guest, before they have typed anything | the guest, after they have chosen food |
| the right failure | **degrade** — reuse, or hold for one tap | **never throttle here.** Refuse only for a real reason (no session, invalid cart, closed restaurant), and say which |
| counts against a limit | yes (10/card, 20/address, and L1's 6 held/card) | no, and it must never gain one |

L1 exists precisely because the current code lets a verification throttle become
an order-submission wall. The fix is to keep the brake where it belongs (on
minting) and to make the *consequence* of being braked a held ticket instead of a
dead end.

### 7.6 What is still a decision, not a fact

- Whether Case C exists at all. Without it, a photographed card can queue
  unlimited held tickets in front of staff; with it, a guest who has already
  been throttled and held six times can be paused, and the cart is kept.
  **Recommendation: keep it**, at 6/hour/card.
- Whether `scan` mode should exist for a new restaurant at all. `scan_confirm`
  costs one tap per sitting; `scan` costs nothing and proves nothing. Nothing in
  the UI defaults to `scan`, and that should stay true.


---

## 8. What is implemented NOW vs what is proposed

Read this before quoting anything above. A behaviour is only claimed when it is
in the code and a test runs it.

### Implemented, tested, on this branch (`c…`+)

| behaviour | where | proven by |
| --- | --- | --- |
| the database's scan answer is read as a closed set, not one `if` | `lib/scan-outcome.ts` | `lib/scan-outcome.test.ts` (17) |
| a **throttled** scan is explained to the guest, on the menu, above the food | `app/t/[token]/route.ts` → `?v=throttled`, `app/menu/page.tsx`, `CustomerMenu` | route tests (3) + screen tests (5) + live check on a production build |
| the explanation survives the item sheet, the cart and the checkout (15 min cookie) | `THROTTLE_COOKIE` | route tests (2) |
| a throttled guest pressing **Place order** is told nothing was sent, and is *not* sent to a code form that cannot help them | `app/menu/checkout/actions.ts` | `lib/place-order-action.test.ts` (2) |
| a throttled scan writes no session — **even if the database returned a token** | route | route tests (2) |
| a stale "paused" flag is cleared once the same browser gets a real session | route | route test (1) |
| retry advice rounds up and never invents a number | `formatRetry()` | unit (4) |

Live check on a production build (`next start`, port 3200, demo mode, no
database): `GET /menu?v=throttled` renders `data-throttle-note` with
"Table check paused" and the sentence; `GET /menu` renders none of it.

### Proposed, NOT implemented — needs a migration and your approval

| behaviour | why it needs SQL |
| --- | --- |
| `reused`: a live session is not re-minted, so reloads stop spending the budget | return shape of `open_table_session` |
| `held`: a throttled sitting mints a session and its orders wait for one tap | `table_session_id`, `hold_required`, `hold_orders` on the session |
| `retry_after`: a real wait time instead of "a short while" | extra column in the function's return table |
| held-cap (Case C) before a hard pause | counting held mints per card |

So today: **a throttled guest is told the truth and keeps their cart, but cannot
order until the window passes or staff take the order.** Their order is not
held, not saved and not queued — saying otherwise would be a lie, and the copy
in `notPlacedNotice()` says exactly the opposite ("Your order was not sent").

### The three questions, answered against the code

| question | today |
| --- | --- |
| what is throttled? | **Verification only.** `open_table_session` — minting a table session from a scan. Order submission is never throttled; it is refused only for a real reason (no session, bad cart, closed restaurant). |
| is a throttled order durably persisted? | **No order exists.** The guest never reaches `place_public_order` without a session, and the session is what was refused. Nothing to lose, and the copy says so. |
| is a held order visible to staff, and how is it recovered? | Not applicable today (nothing is held). The machinery is already built and tested for `scan_confirm`'s first ticket: held rows appear in the board's "Waiting for the floor" strip, one tap confirms the sitting, two taps reject it. |

### A defect this work found and fixed

Writing the throttle marker into `opened` made it a truthy object, and the
route's `if (opened)` then wrote `autodine_table={"throttled":true}` — i.e. it
handed the guest a *table session* because their scan was refused. The
discriminator is explicit now (`if (opened && !opened.throttled)`), and
`route.test.ts` asserts the session cookie is absent for a throttled scan and
present for an opened one.


---

## 9. Where the round-9 evidence lives

| claim | artefact |
| --- | --- |
| unit suite green | `npx vitest run` → 94 files, 1237 tests, 0 failed (after this round's +14) |
| types / lint / design guard | `tsc --noEmit` clean; `eslint .` clean; design guard 5/5 |
| the notice renders | `next build` then `next start -p 3200`; `curl '/menu?v=throttled'` → `data-throttle-note` + "Table check paused"; `curl '/menu'` → absent |
| browser suite | E2E workflow run `40267168265` → annotations "e2e totals :: 9 passed, 0 failed", plus nine individual PASS titles |
| the defect found here | `app/t/[token]/route.test.ts` → "writes no table session, because nothing was verified" |

The browser suite does not cover the throttle banner, because the demo build has
no database and therefore no way to be throttled by it. The unit tests drive the
same components with the same props, and the live curl proves the route wiring;
a Playwright case would need a seeded database in CI, which is a separate
decision about a second Supabase project and is not taken here.
