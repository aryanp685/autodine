# AutoDine — Comprehensive Analysis, Bugs, UI/UX & Startup Brand Plan

**Date:** 2026-11-20 (Arena branch analysis)
**Scope:** Full repository read-only analysis of `autodine-main 2` (Next.js 16, React 19, Supabase, Tailwind 4).
**Audience:** Owner/founder (India) — product, engineering, UX, launch.
**Status rule:** Per AGENTS.md, release/pilot = **NO-GO** until hosted security/migration/recovery/E2E/perf/rollback/operator evidence is recorded. This report does not change that.

---

## 1. Executive summary — what you are building

AutoDine is a **mobile-first, QR-driven restaurant operations SaaS for India**: guests scan a table card, browse menu, build a cart with notes, send order, and track status on their phone (no app install). Staff run kitchen tickets, cashier settlement, bills/invoices, reports, and menu management on tablets/desktops. One account → many outlets → one shared subscription (Model C). Money is integer paise; DB is pricing source of truth; pay-at-counter only (no online guest payments).

**Target:** Indian restaurants/cafés (single outlet to small chains), owner-operators, price-sensitive, GST-registered or composition, UPI/cash/card settlement, Hindi/English staff, low-bandwidth mobile guests.

**Current maturity:** Feature-complete P2–P10 per audit record, 1887+ Vitest pass, typecheck/lint/design/SQL pass, build green. But **hosted production is 28 migrations behind**, `/api/health` ok:false, NO-GO for commercial launch. ~75–80% product-complete; ~35–45% launch-ready.

---

## 2. End-to-end flow

**Guest (pay at counter):**
1. Scan table QR → `/t/[token]` rotating-code verification (5/15min budget) → session minted (59-min, one per table).
2. `/menu` (published menu, card/session gate) → `/menu/item` → cart (client-side) → `/menu/cart` → `/menu/checkout` (server prices) → `place_public_order` (idempotent via guest token, replay returns same order).
3. `/menu/order/[id]` (bearer token in URL, no-store) → live status; 10-min change/cancel window; `/menu/orders` reads browser-stored refs.
4. Call Waiter button → `टेबल X, वेटर ध्यान दीजिए।`.

**Staff:**
- Login/join/invite → selected outlet. Dashboard: tables/sessions, orders, kitchen, cashier, bills/invoices, reports, menus (import/translate/publish), branding, settings (GST/team), subscription.
- Kitchen: ticket state machine new→preparing→ready→served/cancelled; Hindi voice announce (Edge TTS + browser fallback); per-ticket replay; speaker lock.
- Cashier: outstanding bill → Mark Paid (cash/card/UPI recorded after verification) → final invoice → print/share → close session (history preserved, table freed).
- Invoice: consolidated session bill, sequential per-restaurant invoice number, GST conditional (CGST+SGST, tax-inclusive extraction at document level, one rounding), immutable at DB level, void-only audited transition, e-invoice pending IRN when applicable.

**Admin:** `/admin/renew-trial` (operator-auth, staging-only).

---

## 3. Completion status

| Area | Status | Notes |
|---|---|---|
| Guest ordering flow | ✅ Implemented + unit/DB tests | Hosted E2E not verified |
| Server price truth / idempotency | ✅ | C4 race test passes locally |
| Kitchen/cashier | ✅ | Realtime delivery not proven hosted |
| Bills/invoices/GST (two-mode) | ✅ Implemented | Legal/tax approval still locked; no IRP provider |
| Menus (import/AI/translate/publish) | ✅ | AI provider mocked without creds |
| Auth/RBAC/invites | ✅ UI/actions | Real email delivery unverified |
| Subscription (Model C) | ✅ UI + RPC | No payment provider; fail-closed |
| QR/session throttling | ✅ | Isolated browser E2E passed |
| Security (CSP, RLS, search_path) | ✅ Code | Hosted headers/scan not verified |
| Printing/PDF/share | ✅ Browser/OS only | Physical printers not tested |
| TTS voice | ⚠️ Optional | MS Read Aloud no SLA |
| Production deploy/migrations | ❌ 28 behind | NO-GO |
| Backups/PITR | ❌ "No backups" screenshot | Blocker |
| Real app integration (hosted) | ❌ | Not run |
| Capacity/load | ❌ | Not run |

**Overall:** ~78% product-complete; ~40% launch-ready.

---

## 4. Screen-by-screen analysis

All 42 pages and 40+ screen components. Findings consolidated from AUDIT-REPORT (historical), RELEASE-BLOCKER-REPORT, PRODUCTION-READINESS, code.

### 4.1 Guest screens

| Screen | File | Bugs/False logic | UI/UX | Gaps/Drawbacks | Fix (India) |
|---|---|---|---|---|---|
| Home/landing | `HomeScreen.tsx` | Marketing claims pinned by tests; "Interactive preview" sample | Heavy GSAP/motion; desktop-first hero on mobile | No vernacular; no trust badges (FSSAI/GSTIN) | Add Hindi/regional hero, trust strip, faster LCP |
| Menu | `CustomerMenu.tsx` | Card/session gate required; published-menu lookup | Image-heavy; low-bandwidth risk | No offline; no search/filter by veg/non-veg | Add veg/non-veg badges, search, image lazy-load, skeleton |
| Item detail | (menu/item) | Cart client-side | — | Allergens/dietary not shown | Add allergen icons (Indian norms) |
| Cart | `CartScreen.tsx` | Tax sample fallback (C1 historically fixed) | Totals before rate load | No coupon (disabled by policy) | Keep disabled; show "Taxes" generic label |
| Checkout | `CheckoutScreen.tsx` | Server price truth | Confirm screen mandatory | No payment mode selector (intentional) | Keep pay-at-counter; show UPI ID/QR for pay-at-counter |
| Order placed | `OrderPlacedScreen.tsx` | — | — | Status polling | Add WhatsApp order confirmation |
| Order status | (menu/order) | Bearer token in URL (history/log exposure) | — | Token leak risk | Short-lived token; move to cookie/header |
| Orders list | (menu/orders) | Reads browser refs | — | Cross-device not synced | Acceptable; document |
| Table verify | `TableVerifyScreen.tsx` | Attempt budget 5/15min | — | Confusing for elderly | Larger tap targets, Hindi |
| Table gate | `TableGateScreen.tsx` | — | — | — | — |
| Verify-to-order | `VerifyToOrderScreen.tsx` | — | — | — | — |
| Qr problem | `QrProblemScreen.tsx` | Allowlisted reason | — | Generic | Add contact/WhatsApp help |
| Guest orders | `GuestOrdersScreen.tsx` | — | — | — | — |
| Storefront closed | `StorefrontClosedScreen.tsx` | — | — | — | Add reopen time + WhatsApp |

### 4.2 Staff screens

| Screen | File | Bugs/False logic | UI/UX | Gaps | Fix |
|---|---|---|---|---|---|
| Dashboard | `DashboardScreen.tsx` | Active sessions; unpaid→mark paid | — | No at-a-glance revenue today | Add KPI cards (today's sales, open tables) |
| Orders | `OrdersScreen.tsx` | Cashier projection not DB boundary (finance cols readable) | — | RLS hardening pending | Enforce role-filtered projection |
| Kitchen | `KitchenScreen.tsx` | Double-announce per-device (O1 fixed via server claim) | Voice noise | No offline queue | Keep server claim; add mute toggle |
| Cashier | `CashierScreen.tsx` | Settlement simple tick | — | No partial payments | Keep simple (approved) |
| Tables | `TablesScreen.tsx` | Label fallback fixed | — | — | — |
| Menu editor | `MenuEditorScreen.tsx` | Snapshot restore | — | Bulk edit UX | Add bulk price update, veg/non-veg filter |
| Menu import | `MenuImportScreen.tsx` | AI draft-only | — | Provider mocked | Wire AI with creds + cost guard |
| Menu translate | `MenuTranslateScreen.tsx` | Original untouched | Print route | — | Add regional languages (Hindi/Marathi/Gujarati/Tamil/Telugu) |
| Branding | `BrandingScreen.tsx` + preview | — | — | — | Add logo/favicon, color themes |
| Invoices | `InvoiceScreen.tsx` / history | Immutable; void-only | — | — | — |
| Payment receipt | `PaymentReceiptScreen.tsx` | — | — | — | — |
| Reports | `ReportsScreen.tsx` | Owner/Manager only | Export route | — | Add GST summary, UPI reconciliation |
| Settings | `SettingsScreen.tsx` + GST/team | GST two-mode | — | GSTIN capture, attestations | Keep fail-closed |
| Subscription | `SubscriptionScreen.tsx` | Model C; no provider | — | No checkout | Add provider when approved |
| Outlet new | (route) | — | — | — | — |
| Brand review | `BrandReview.tsx` | — | — | — | — |
| Design chooser | `DesignChooser.tsx` | — | — | — | — |
| Invoice notes | `InvoiceNotesPanel.tsx` | — | — | — | — |
| E-invoice | `EinvoiceAttemptButton.tsx` + reconciliation | Pending IRN | — | No provider | Keep pending |

### 4.3 Auth & admin screens

| Screen | File | Notes |
|---|---|---|
| Login/Signup/Forgot/Reset | `LoginScreen`, `SignupScreen`, `ForgotPasswordScreen`, `ResetPasswordScreen`, `SignupConfirmationPendingScreen` | Real email delivery unverified; Hindi copy; larger inputs for mobile |
| Join/Join code | (join) | Invite redemption unverified |
| Admin renew-trial | (admin) | Operator-auth; staging-only |
| Pricing | `PricingScreen.tsx` | Plan cards linked; INR formatting |
| Bill share | (receipt-share) | Bearer token expiry/revocation; per-token read budget |
| Bill/Invoice view | `BillScreen.tsx`, `InvoiceScreen.tsx` | Staff-authenticated; print |

### 4.4 Kiosk

| Screen | File | Notes |
|---|---|---|
| Display | (kiosk/dashboard/display) | Staff role/tenant |

---

## 5. Cross-cutting issues

- **GST (locked):** Two-mode (normal/composition/regular 5%/18%). Tax-inclusive, document-level rounding. No IRP provider → pending. Place of supply always outlet state. Never invent rates. UI must never show "GST 5% sample" (fixed). Gaps: no GSTIN verification, no HSN/SAC, no e-way bill. Keep gated.
- **Money:** integer paise ✅; DB source of truth ✅; `orders_math_check` ✅.
- **Throttling:** QR/session minting only; order submission never throttled ✅; guard test prevents regression.
- **Subscriptions:** Model C; trial 21 days materialized; downgrades read-only, no deletion ✅; no provider → fail-closed.
- **Public data:** only name/phone/address via `public_restaurant_profile()` ✅; GSTIN never public ✅.
- **Security:** RLS, fixed search_path ✅; production headers/scan unverified; bearer token in URL risk; finance cols readable by cashier role (hardening pending).
- **Realtime:** `orders` and `table_waiter_calls` published; delivery/reconnect not proven hosted.
- **TTS:** optional, no SLA.

---

## 6. India-specific considerations & fixes

1. **GST compliance UX:** Show GSTIN on bill only; composition → Bill of Supply with statutory notice; regular → tax invoice; B2B recipient capture only on regular; e-invoice pending badge; never present pending as final. Add "download for CA" export.
2. **Payments:** Pay-at-counter with UPI ID/QR shown on bill; record UPI ref number; cash/card/UPI. No gateway (approved). Add daily UPI reconciliation report.
3. **Languages:** Hindi first; add Marathi, Gujarati, Tamil, Telugu, Bengali, Kannada, Malayalam for menu + UI. Keep original menu text untouched; translations separate.
4. **Mobile-first & low bandwidth:** Compress images (WebP), lazy-load, skeleton screens, offline cart, retry, small payloads. Test on 3G.
5. **Trust & legal:** FSSAI number, GSTIN, address, phone on footer/bill; terms/privacy in simple language; refund/cancellation policy (counter-only).
6. **WhatsApp:** Order confirmation, bill share, daily summary to owner via WhatsApp (business API later). Currently share link only.
7. **Regional pricing & portions:** Half/full, combos, thali, add-ons, spice level, Jain/no onion-garlic flags. Add dietary badges (veg/non-veg/egg/Jain).
8. **Festivals/peak load:** Capacity tests for Friday night; kitchen load balancing; queue handling.
9. **Devices:** Cheap Android phones, tablets; large tap targets; Hindi fonts; avoid heavy animations on low-end.
10. **Offline resilience:** Service worker for menu; retry order submission; idempotency already supports replay.

---

## 7. Startup brand upgrade suggestions (high-tech positioning)

**Product/UX:**
- Rebrand from "AutoDine" utilitarian to a premium hospitality-tech brand: warm porcelain + forest (already) but tighten typography, motion restraint, consistent iconography.
- Add a "live table" real-time view for owner (who's ordering, what's cooking) with WebSocket; currently polling.
- Smart upsell: "frequently ordered with", portion suggestions, time-of-day menus (breakfast/lunch/dinner).
- AI menu: photo→dish extraction (already draft), auto-translate, allergen tagging, price suggestions by category.
- Voice ordering at table (speech-to-text) for accessibility.
- Loyalty/CRM: repeat guest recognition by phone, favorite dishes, birthday offers (consent-based).
- Multi-language menu with one-tap switch; auto-detect device language.
- Dark mode for kitchen (already? check) for night service.

**Growth/monetization (India):**
- Freemium: 14-day trial (currently 21) + Starter ₹999. Add annual discount, referral credits.
- Partner with POS/printer vendors; Zomato/Swiggy menu sync (export).
- Case studies, owner testimonials, "setup in 10 minutes" video.
- SEO: local restaurant keywords, city pages, Hindi content.
- Analytics: repeat rate, avg ticket, peak hours, item margins (cost price input).

**Tech/infra:**
- Observability: Sentry, PostHog, uptime; structured logs; alerting.
- Performance budgets: LCP <2.5s on 3G; bundle analysis.
- Accessibility: WCAG 2.1 AA; keyboard nav; screen reader; contrast.
- Security: CSP report-only → enforce; dependency scanning; pen test before launch.
- Data: backups/PITR, DR drill, migration runbook (already documented).
- CI: hosted E2E with synthetic data; load tests.

---

## 8. Prioritized roadmap (next 90 days)

**P0 (launch blockers):** backups/PITR + restore drill; apply 28 migrations to production with approval; hosted E2E guest→staff; clock discrepancy resolution; capacity test; security scan.

**P1 (product hardening):** bearer token → cookie; finance projection RLS; realtime delivery proof; Hindi/regional UI; UPI ref recording; WhatsApp share.

**P2 (brand/growth):** AI menu polish, loyalty, analytics, SEO, case studies, onboarding wizard, demo video.

**P3 (scale):** multi-language, integrations (POS, Zomato), advanced reporting, white-label.

---

## 9. What not to touch (locked decisions)

- GST rates/rules (adviser approval only); discounts disabled; online guest payments disabled; pay-at-counter only; one session per table; immutable invoices; browser/OS printing only; no KOT print; kitchen announcement content/order fixed; scan-limit L1 semantics; Model C subscriptions; public data = 3 facts.

---

## 10. Files of record

- `AGENTS.md`, `AUDIT-REPORT.md`, `RELEASE-BLOCKER-REPORT.md`, `PRODUCTION-READINESS.md`, `FEATURE-INVENTORY.md`, `docs/website-readiness-audit.md`, `docs/scan-limit-l1.md`, `docs/e2e-local.md`, `docs/preview-isolation.md`.

*Report is analysis only; no code changed.*
