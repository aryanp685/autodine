# AutoDine — Full Audit Report (2026-11-06)

Branch: `arena/149fe709-autodine` (base = `7917687`, latest main). **No code changed.**
Gates run today: typecheck ✅ · unit **1817 passed / 3 skipped** ✅ · lint 0 errors (1 warning) · design ✅ (5/5 hex, 2/2 glass, 0/0 fonts). E2E: green at PR #156 merge (CI), not re-run today.

---

## 1. Status — kitna hua, kitna baaki

| | |
|---|---|
| Platform (menu AI, storefront, QR, orders, payments, voice, security) | **DONE** — production live |
| Redesign spec (Order→Kitchen→Billing) Phase 1 audit | **DONE** |
| Redesign implementation P2–P10 | **0% coded** — machinery ~35-40% exists |
| Overall redesign remaining | **~60%** — heaviest: consolidated invoice (P6), session close (P8), printing (P7) |

---

## 2. DONE (working + tested)

- **Menu pipeline:** photo import → AI review (draft only) → pair publish + rollback (menu edits auto-restore via `menu_content` snapshot).
- **Storefront:** design switch, branding, translations (original untouched), multi-outlet, closed-state.
- **QR & sessions:** 3 verification modes (`code` / `scan_confirm` / `scan`), 59-min sessions, code rate limits (5/15min).
- **Ordering:** cart → checkout → order status → 10-min change/cancel window. **Server-side price truth** (browser sends ids+qty only). **Idempotent** (guest-token replay returns same order). **Rate limits** (30/session, 60/table, 60/ip per 10 min).
- **Payments:** Razorpay verify + webhook (raw-body HMAC, amount pinned to attempt, idempotent settle) + counter cash recording (amount never typed).
- **Kitchen/Cashier:** prep state machine (new→preparing→ready→served/cancelled), Hindi voice announcements (Edge TTS neural + browser fallback), per-ticket replay, speaker lock, missed-replay.
- **Security:** CSP nonce, safe login redirects, guest rate limits, RLS + `security definer` + `search_path`, payment RPCs service_role-only, token-scoped order reads (privacy safe).
- **Also:** staff invites/RBAC, trial write-gate, per-order bill + WhatsApp share, `orders_math_check` DB constraint, integer-paise money module.

---

## 3. REMAINING (locked plan, P2→P10)

| Phase | Baaki kya | Size |
|---|---|---|
| **P2** Pay at Counter | Online/gateway remove from customer checkout, button = "PLACE ORDER & PAY AT COUNTER", mandatory confirmation screen | Small |
| **P3** Table sessions | One table = one session = one bill; additional orders = new tickets (naye items only) + idempotency hardening | Medium |
| **P4** Dashboard | Active-table session cards + **UNPAID → simple Mark Paid tick** | Medium |
| **P5** Voice | Auto-announce on confirm + announce status persist + per-ticket re-announce + **Call Waiter** button | Medium |
| **P6** Invoice | **BIGGEST** — consolidated session bill, unique sequential invoice numbers, GST conditional (CGST/SGST/IGST, inclusive/exclusive), item+bill discounts, immutable snapshots | **Large** |
| **P7** Printing | A4 + 58mm + 80mm layouts, Print Final Bill, PDF download, secure share link. (KOT print REMOVED — screen-only tickets.) | Medium |
| **P8** Checkout/close | Review → bill → Mark Paid → final invoice → print/share → close session (history preserved, table freed) | Medium |
| **P9** Security | `/join/[code]` attempt budget + Permissions-Policy header (P3s), audit logs, retry safety | Pass |
| **P10** Tests | 15 real-world scenarios + call-waiter + paid-tick + print/PDF match | Gate |

Locked decisions: pay-at-counter only (gateway off for customer orders), no payment-mode UI (simple tick), announcement = order no. + table + items + qty + note, Call Waiter text "टेबल X, वेटर ध्यान दीजिए।", Invoice Spec v1.0, browser/OS printing only (USB/BT/LAN future).

---

## 4. BUGS / false logic — jo ho gaya hai usme

### 4a. Customer side (guest app)

| # | Bug | Impact | Where | Fix |
|---|---|---|---|---|
| C1 | **Tax display can disagree with charge** — cart/checkout falls back to SAMPLE 5% when restaurant rate didn't load; DB charges the real rate (usually 0%) | Guest sees wrong total; bill vs screen mismatch (edge case) | `components/screens/CartScreen.tsx:31`, `CheckoutScreen.tsx:59`, `lib/pricing.ts` | Show tax only from loaded restaurant rate; block totals until loaded |
| C2 | **"GST 5% · sample" wording can reach guests** | Unprofessional; legally misleading on a bill-adjacent screen | `lib/pricing.ts:39` (`gstLabel`) | Remove "sample" label; P6 = real GST model |
| C3 | **Duplicate order codes possible → random order failures** (~50% collision after ~7,400 orders per restaurant; code = 5 chars, 33-alphabet, NO unique index) | Guest's valid order randomly fails to place (token-attach update matches 2 rows → rollback) | `supabase/migrations/20261019000001_init.sql:158` (no unique), `20261108000200` (`update … where code = v_code`) | `unique index on orders(restaurant_id, code)` + retry in code-gen |
| C4 | **Idempotency race depends on plpgsql rollback semantics** (order written before token attach) | Today correct (verified), but a refactor can silently create ghost duplicate orders/tickets | `guest_rate_limits.sql:155-232` | Regression test + code comment; revisit in P3 |

### 4b. Owner / staff side (dashboard, kitchen, cashier)

| # | Bug | Impact | Where | Fix |
|---|---|---|---|---|
| O1 | **Two kitchen devices double-announce the same ticket** — announce dedupe is per-device memory only | Staff hears every ticket twice; noise | `KitchenScreen.tsx:907` (`new:${orderId}` + `seenKeysRef`) | Server-side "announced once" claim (P5) |
| O2 | **Duplicate order codes shown on boards** (same root as C3) | Two tickets with identical codes → staff can act on the wrong ticket (cancel/serve/payment) | code gen in `place_public_order_core` | Same fix as C3 |
| O3 | **Old order can be wrongly re-stamped on code collision** (token-less path: `stamp_guest_verification` matches by code) | Old ticket's session/hold data overwritten | `drift_reconcile.sql` Part 3 | Same fix as C3 |
| O4 | **"GST 5% · sample" on bill screens** | Owner shows a legally-wrong tax line to customers | `billTaxSplit` label path via `gstLabel` | Fix with C2 + P6 (GSTIN-conditional invoice) |
| O5 | Lint warning `ImportedItem` unused; table fallback label `T${Date.now()}` after 999 tables | Cosmetic | lint output; `app/(staff)/dashboard/tables/actions.ts:61` | One-liners |

### 4c. Systemic (both sides) — "false logic" / half-finished declarations

| # | Issue | Detail |
|---|---|---|
| S1 | **`lib/pricing.ts` header still says "SAMPLE ONLY… must not be used for a live transaction"** — but it IS live | False documentation. Tax model (exclusive-only, CGST/SGST-only, single rate per restaurant) is genuinely half-done vs Invoice Spec v1.0 (needs IGST, inclusive pricing, per-item rates, GSTIN-conditional) |
| S2 | **Announcement status lives in memory** (not in DB) | Dashboard can't show "announced/failed" persistently (P5 scope) |
| S3 | **No invoice numbering exists anywhere** | P6 must build sequential per-restaurant invoice series (spec v1.0 rule: never reuse) |

---

## 5. Verified GOOD (never weaken)

Server-side price truth · integer-paise money (half-away-from-zero) · `orders_math_check` DB constraint · order_items name/price snapshots (menu edits never rewrite history) · Razorpay raw-body HMAC + idempotent settle + attempt-pinned amount · token-scoped order reads (cross-table leak impossible) · atomic DB rate limits · rollback snapshot safe on FKs · payment RPCs service_role-only · QR HMAC + session expiry · RLS + `search_path` everywhere.

---

## 6. Next steps (aapke approval ke bina koi code nahi)

1. **Fix phase** (chhota PR): C1–C3/O1–O3 root fixes = orders.code unique index + tax label/comment cleanup. (~half day)
2. **P2** Pay-at-counter checkout.
3. Phir P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10, har phase ke baad report (files, migrations, APIs, risks, tests).
