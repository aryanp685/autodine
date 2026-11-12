# Subscription and billing — implementation record, 2026-11-10

Branch `arena/a5344572-autodine`, worktree `/home/user/autodine`.
Parent commit `71f46ce5aa5aacbf87fd4d5d46b9f679375c3d01`.
Chain: **71 migrations**, the last being `20261110001100_subscription_billing.sql`.

This document records the commercial subscription system as built. It is the
companion to `docs/verification-2026-11-10.md`, which records the read-only
review that preceded it.

---

## 1. The rules this implements

| Rule | Value |
| --- | --- |
| Starter | ₹999 / month, 1 outlet |
| Professional | ₹2,699 / month, 5 outlets |
| Business | ₹3,699 / month, unlimited outlets |
| Trial | 21 days, every main product feature |
| Model | C — one account-level subscription shared by every outlet of the account |
| Currency | INR only |
| Billing period | Monthly. No annual price is approved. |

Three decisions are load-bearing and appear throughout the code:

1. **A subscription belongs to the account (the owner), not to an outlet.**
   Every entitlement question is answered from `public.accounts`, reached from
   a restaurant through `restaurants.account_id`. There is no per-outlet
   subscription to disagree with it.
2. **A downgrade or an expiry never deletes anything.** It changes what may be
   *created next*. Outlets, orders, menus, tables and history all survive, and
   the screen says so in those words.
3. **No payment provider is approved or configured.** Everything
   provider-independent is built and working. Everything provider-dependent
   fails closed.

---

## 2. Database

### 2.1 Migration added

`supabase/migrations/20261110001100_subscription_billing.sql` (~1,470 lines).

### 2.2 New tables

| Table | What it holds | Who may read it |
| --- | --- | --- |
| `trial_grants` | One row per person who has had a trial. The grant belongs to the *person*: deleting an account does not hand them a fresh one. | service_role only |
| `subscription_payments` | Every payment attempt — succeeded, failed, refunded — with the provider's event id and the period it bought. | members of the account |
| `subscription_receipts` | Immutable receipts, numbered `AD-SUB-YYYY-######` from the sequence `subscription_receipt_seq`. | members of the account |
| `subscription_events` | The story of one subscription, in order: trial granted, extended, denied, plan changed, renewed, payment succeeded/failed, cancellation requested/withdrawn/confirmed, expired. | members of the account |
| `billing_webhook_events` | What arrived from a provider: event id, payload digest, whether the signature was good, and the outcome. | service_role only |

New columns on `public.accounts`: `cancel_requested_at`, `cancel_effective_at`.
The `plan_status` check constraint was widened to six values —
`trialing, active, past_due, cancel_requested, expired, cancelled` — because a
failed payment and a requested cancellation are states a subscription can be
in, and neither means "no access".

### 2.3 New and replaced functions

| Function | What it does |
| --- | --- |
| `plan_price_paise(text)` | The approved price in paise, written as rupees × 100. Null for anything not for sale. |
| `claim_account_trial(uuid)` | Issues the one trial, once per person. service_role only. |
| `record_subscription_payment(...)` | Records a payment, extends the period, issues a receipt, writes history. service_role only. |
| `record_subscription_payment_failure(...)` | Marks the account `past_due` and records why. Does not remove access. |
| `record_subscription_refund(...)` | Records a refund as a **new** row. The original payment is never edited. |
| `request_subscription_cancellation(uuid)` | Owner-only. Runs to the end of the period. |
| `withdraw_subscription_cancellation(uuid)` | Owner-only. Undoes the request. |
| `confirm_subscription_cancellation(...)` | service_role. Refuses unless a request exists. |
| `expire_subscriptions()` | Marks ended subscriptions `expired`. Deletes nothing. |
| `account_subscription_state(uuid)` | Everything the dashboard needs, in one row. Returns null for a non-member. |
| `account_subscription_history`, `account_payment_history`, `account_receipt` | Reads, each membership-checked. "Not yours" and "does not exist" return the same null. |

Replaced from the previous migration: `account_can_write`, `protect_account_plan`,
`create_outlet`, `create_account_with_restaurant`.

### 2.4 The three enforcement points

**Outlet limits** are enforced in `create_outlet()`, which raises `outlet_limit`.
The count is the account's outlets, so a Starter account's first restaurant is
its one outlet. A downgrade blocks creation and preserves every outlet; an
upgrade restores capacity with nothing recreated.

**The write gate** (`account_can_write`) is the authority on whether an account
may write. It reads the *period*, not the label:

- `expired` → read-only;
- `cancelled` → writable until `cancel_effective_at`, because a cancellation
  stops the next renewal, not the service already paid for;
- `active`, `past_due`, `cancel_requested` → writable until `plan_expires_at`;
- `trialing` → writable until `trial_ends_at`.

**The plan guard** (`protect_account_plan`) freezes every plan column against
any authenticated caller. It permits exactly one status change by an owner:
to `cancel_requested` with both request columns set, and back again on
withdrawal. Both are downward — neither can grant entitlement — and `plan`
itself is always restored to its old value, so the exception cannot be ridden
to a better plan.

### 2.5 Immutability

`subscription_payments`, `subscription_receipts` and `billing_webhook_events`
are append-only. A payment row cannot be updated or deleted; a receipt cannot
be rewritten; a correction or a refund is a new row. The webhook log is the one
table that finishes rather than freezes: `outcome` may be written, but the
provider, event id, payload digest and signature verdict may never change,
because those are the replay evidence.

### 2.6 Trial migration

The backfill lives in `20261110001000_account_subscriptions.sql` and computes
each existing account's trial end from the state that trial was actually in
when it ran:

- still running on the 7-day rule → `activation + 21 days`;
- already expired → `activation + 7 days`, a date in the past.

The activation date is never moved. `trial_grants` was backfilled one row per
person from the accounts that existed, so nobody who had a trial can get
another by recreating their account.

---

## 3. Application

| Path | What it is |
| --- | --- |
| `lib/billing/catalog.ts` | Prices in paise, derived from `lib/plans.ts`. The receipt disclaimer. |
| `lib/billing/provider.ts` | The provider boundary. `getBillingProvider()` returns null, always, until a real adapter exists. |
| `lib/billing/webhook.ts` | HMAC signature verification, timestamp window, replay key, amount and currency validation. |
| `lib/billing/actions.ts` | Server actions: request/withdraw a cancellation; choose a plan and retry a payment (both refuse while no provider exists). |
| `app/api/billing/webhook/route.ts` | The only path that may switch a paid plan on. |
| `lib/db/subscription-screen.ts` | Loads the screen through the membership-checked reads. |
| `components/screens/SubscriptionScreen.tsx` | The owner dashboard. |
| `app/(staff)/dashboard/subscription/` | The page, its `loading.tsx`, and the receipt route. |

### 3.1 The webhook, in order

1. **No provider, no processing.** Returns 503 and records nothing.
2. **The raw body is verified, then parsed.** The HMAC covers the exact bytes
   that arrived.
3. **The signature must be valid and fresh.** Constant-time compare, five-minute
   window.
4. **The event is recorded before it is acted on.** The unique key on
   `(provider, provider_event_id)` is the replay protection; a second delivery
   inserts nothing and changes nothing.
5. **The amount must be the approved price, in INR.** Checked in the
   application against the catalog, and again inside
   `record_subscription_payment()`. Neither check trusts the other.

### 3.2 Receipts are not tax invoices

A GST tax invoice carries the supplier's GSTIN, the recipient's details, an
HSN/SAC code and a tax split. A subscription receipt carries none of those.
Every surface that shows one — the receipt page, the payment list, the history
— states the difference on its face.

### 3.3 The owner-facing screen

Plan comparison with the approved prices; trial countdown from the original
activation date; current plan and outlet usage ("3 of 5 outlets", or
"Unlimited"); upgrade and downgrade actions; subscription history; payment
history with receipt links; expiry, failed-payment and cancellation messages;
and a plain statement that online payment is not switched on.

Three states look alike and are distinguished by their cause: a running trial,
a period that is ending, and a payment that failed. All three keep the owner's
data; only one is the owner's doing, and the screen says which.

---

## 4. Provider-dependent work that remains

Nothing here is blocked on a decision; all of it is blocked on a provider.

1. **Choose an approved provider.** Set `BILLING_PROVIDER`, `BILLING_API_KEY`
   and `BILLING_WEBHOOK_SECRET`. All three, or the system stays closed.
2. **Write the adapter** — the only file that changes. It fills
   `BillingProvider`: `createCheckoutSession`, `verifyPayment`,
   `verifyAndParseWebhook`, `reconcile`, `renew`, `cancel`, `refundStatus`.
   A provider that signs differently is accommodated there, not by weakening
   `lib/billing/webhook.ts`.
3. **Uncomment the checkout call** in `choosePlanAction` and in
   `retryPaymentAction`. Both are written out in full behind the refusal.
4. **Schedule `expire_subscriptions()`** — a cron or an edge function, daily.
   It deletes nothing; it only marks ended periods.
5. **Schedule renewal** through the provider's mandate, not by writing plan
   dates from the application.

Until then: no checkout sessions, no charges, no paid activation on an
unverified client request, no invented credentials.

---

## 5. Verification

Disposable PostgreSQL only, created and dropped by
`scripts/verify-database.mjs`. Nothing here connects to production or to a
hosted staging database.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 problems |
| `npx vitest run` | 2,095 passed, 114 skipped (2,209) |
| DB, clean replay of 71 migrations | 114 passed |
| DB, forward upgrade from the observed staging baseline | 114 passed |
| DB, financial forward-upgrade preservation | 114 passed, `FINANCIAL_FORWARD_UPGRADE_PRESERVED` |
| `scripts/reconcile/reconcile-migrations.mjs` | exit 0 |
| `npm run build` (demo-build env guard) | compiled, 3 new routes |

`lib/db/subscription-billing.integration.test.ts` adds 32 tests over real roles:
`anon` for a guest, `authenticated` with a JWT subject for an owner and for a
stranger. They cover the catalog prices and the refusal to price a plan that is
not for sale; a 21-day trial recorded as a grant; a second trial refused to the
same person; a running trial never shortened and an ended one never revived;
the trial backfill **re-read out of the migration and run again** over rows
arranged to look like the old world; outlet limits 1, 5 and unlimited;
cross-outlet entitlement; tenant isolation for payments and receipts; a payment
recorded once with a receipt and an extended period; a duplicate provider event;
an amount mismatch; a non-INR currency; a failed payment that keeps the account
working; a refund recorded as its own row; append-only enforcement; no
authenticated inserts; cancellation requested, withdrawn and confirmed, with a
stranger refused; expiry that loses nothing and never re-grants; and no
authenticated caller able to set a plan or write a payment.

`components/screens/SubscriptionScreen.test.tsx` adds 11 tests over the rendered
screen: the three approved prices appear and no invented one does; the
provider-unavailable state is stated and not dressed up as "coming soon"; the
trial counts down from its activation date; the cancellation section says what
survives cancelling; the word "tax invoice" appears nowhere on a subscription
screen; a manager sees the account's state but is offered no money button; an
expired account is told it ended and that nothing was deleted; and a failed
payment is blamed on the payment, not the owner.

`lib/plans.test.ts` gained 7 tests that parse the migrations and fail if the SQL
and the TypeScript disagree: the three prices (read as rupees × 100, so a price
pasted in without the conversion is caught), the single currency, the amount
and currency refusals, and the outlet limits.

### Not run

Browser end-to-end, as before: `@sparticuz/chromium` needs shared libraries
that are absent and uninstallable here, and `cdn.playwright.dev` is not
reachable. `scripts/e2e/` and the Playwright specs are therefore NOT RUN.

---

## 6. Open items

1. `supabase/migrations/20261109000400_order_write_boundary.sql` remains a
   published migration edited in place. Carried over from the review; recorded
   in `docs/migration-reconciliation.md` as an owner decision.
2. `reconcile-migrations.mjs` notes that re-running `20261110001000` after the
   full chain changes four functions — `create_outlet`, `account_can_write`,
   `protect_account_plan` and `create_account_with_restaurant`. That is the
   intended forward path: `20261110001100` replaces all four deliberately. It
   is not drift.
3. No separate limits exist for staff, tables, menus or orders. Those need an
   approved plan-feature matrix and were not invented here.
