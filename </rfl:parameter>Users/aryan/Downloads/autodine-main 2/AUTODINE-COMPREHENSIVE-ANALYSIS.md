# AutoDine — Comprehensive Analysis Report

Generated: read-only exploration of repository at `/Users/aryan/Downloads/autodine-main 2` (branch `arena/149fe709-autodine`). No code modified.

## 1. Executive summary

AutoDine is a mobile-first QR ordering + restaurant operations SaaS for Indian restaurants. Stack: Next.js 16.4.6, React 19, Supabase (Postgres + Auth + Realtime), Tailwind/Inter, Vercel (`bom1`). Scope: guest QR menu/ordering, table sessions, kitchen/cashier dashboards, invoicing (GST conditional), subscription (Model C per-account), branding, menu import/AI review. Current state: feature-complete P2–P10 per audit record, but release/pilot status is **NO-GO** pending hosted security/migration/recovery/guest-to-staff E2E/performance/rollback/operator approval. Vitest 2,502 passed / 223 skipped, lint 0 errors, typecheck pass, design check pass, sql parser pass. 101 migrations, 42 pages, 44 screens, 11 route handlers.

## 2. Architecture & flow

- Guest: QR token → `/t/[token]` verification (3 modes: code/scan_confirm/scan) → session mint (59-min) → `/menu` published menu → cart (client) → checkout (server price truth, idempotent) → order status → 10-min change/cancel window → pay at counter. Order submission never throttled (scan/session minting throttled only).
- Staff: auth → `/dashboard` (tables/sessions, orders, kitchen, cashier, invoices, reports, branding, menus, settings, subscription). Kitchen announces order no./table/items/qty/note via TTS. Cashier marks paid (separate from served). Session close → consolidated bill → print/PDF/share → history preserved, table freed.
- Admin: `/admin/renew-trial` operator action.
- Money: integer paise, DB source of truth. GST: two modes (normal off; composition Bill of Supply; regular 5%/18% tax-inclusive, document-level extraction). e-Invoice: IRP pending state, no provider configured. Subscriptions: Model C per account, trial 21 days, Starter/Professional/Business outlet limits; downgrades preserve data, read-only.

## 3. Completion status

Done & tested locally: menu pipeline, storefront, QR/sessions, ordering with server price truth + idempotency, kitchen/cashier state machine, Hindi voice, security (CSP nonce, RLS, token-scoped reads), invoices, printing, tests (15 receipt scenarios). Pending/unverified: hosted schema parity, backups/PITR, guest→staff E2E, load/soak, rollback, Vercel firewall/WAF, account-member billing scope, guest bearer-token URL exposure, e-Invoice IRP provider (none approved), subscription provider (none). Estimated completion ~85–90% code/test, 0% hosted release gates.

## 4. Screen-by-screen analysis (components/screens)

44 screens. Key findings (cite file:line):

- CartScreen.tsx:31/39 — tax display falls back to sample 5% when restaurant rate not loaded; gstLabel may present sample %. Fix: block totals until loaded; show "Taxes" generic.
- CheckoutScreen.tsx:59 — same fallback; server charges real rate → mismatch.
- KitchenScreen.tsx:907 — announce dedupe per-device only → double announce across devices. Fix: server-side announced-once claim.
- Tables actions.ts:61 — fallback label `T${Date.now()}` after 999 tables (cosmetic).
- BillScreen/InvoiceScreen/PaymentReceiptScreen — GST label path via gstLabel; immutable invoice triggers enforce DB-level immutability.
- GuestOrdersScreen, GuestOrderEditor — bearer token in URL; no-store doesn't remove history/log exposure (noted in feature inventory).
- MenuEditorScreen, MenuImportScreen, MenuTranslateScreen — AI review draft-only; pair publish+rollback.
- SubscriptionScreen — provider disabled; owner-only actions.
- SettingsScreen/GstSettingsPanel — GSTIN registration type gates composition; specified-premises attestation for 18%.
- BrandingScreen/DesignChooser/BrandingPreview — design switch.
- HomeScreen/PricingScreen/SampleMenu/StorefrontClosedScreen — public/demo; commercial claims need approval.
- Auth screens (Login/Signup/ForgotPassword/ResetPassword/SignupConfirmationPending) — Auth/email delivery hosted dependency.
- TableGate/TableVerify/VerifyToOrder/QrProblem — QR verification.
- CashierScreen/OrdersScreen/DashboardScreen/ReportsScreen/TablesScreen/InvoiceHistoryScreen — staff ops; reports owner/manager only.
- InvoiceNotesPanel/EinvoiceAttemptButton/EinvoiceReconciliationPanel — e-Invoice pending.
- ImportShowcase/BrandReview — review flows.

Gaps common: no offline/low-bandwidth handling, no regional language beyond Hindi announcements, no UPI self-claim UI (intentionally disabled), no WhatsApp deep integration beyond share link, no accessibility audit beyond basic.

## 5. Cross-cutting issues

- Security: anon SELECT ACLs on orders but no SELECT policy (no demonstrated access); `restaurant_can_write` executable by anon (exposes write bit only, needed by RLS shape); 8 `FOR ALL` policies in staff_invites migration lack TO clause → apply to PUBLIC. Hosted parity unverified.
- Money: integer paise enforced; DB source of truth; orders_math_check constraint. Good.
- GST: fail-closed gating; no provider for e-Invoice; immutable documents with audited void. Good design.
- Throttling: order submission never throttled (verified guard test); scan/session minting throttled. Good.
- Subscriptions: Model C per account; read-only on expiry; no provider.
- Public data: only name/phone/address via public_restaurant_profile(); GSTIN only on issued bill. Good.

## 6. India-specific considerations

- GST: composition vs regular, CGST+SGST (place of supply outlet state), tax-inclusive extraction at document level. Locked. Need adviser approval before live.
- UPI: no online gateway in guest checkout (pay at counter). Could add UPI QR for counter payment later (approval needed).
- WhatsApp: share link for bills; could add order status updates (approval).
- Regional languages: only Hindi TTS announcements; menu translations exist; UI English only. Need Hindi/Tamil/Telugu/Bengali UI for broader India.
- Mobile-first: responsive artifacts present; low bandwidth: no image optimization/offline cache noted.
- GSTIN/FSSAI: GSTIN on bill only; FSSAI license number not prominently surfaced (check settings).
- Phone: customer-facing phone in profile.

## 7. Startup brand upgrade suggestions

- Design: consistent design system (check-design-system passes 5/5 hex, 2/2 glass). Upgrade to premium brand identity, micro-interactions, skeleton loaders, empty states.
- Features: WhatsApp order updates, UPI QR at counter, loyalty, analytics dashboard, multi-language UI, offline menu cache, push notifications, reviews/ratings, table reservation, CRM.
- Positioning: "India's smartest restaurant OS" — emphasize zero-hardware, QR-first, GST-compliant, pay-at-counter.
- Growth: freemium trial 21 days, referral program, restaurant network effects, integrations (POS, accounting).

## 8. Prioritized roadmap

P0 (release blockers): hosted schema parity/migration verification, backup/PITR, guest→staff E2E, load/soak, rollback, Vercel firewall/WAF, operator approval. P1: fix double-announce server claim, order code unique index + retry, tax display fallback, guest token URL exposure decision, RLS anon/public policy refactor with tests. P2: multi-language UI, offline cache, UPI QR, WhatsApp updates (with approvals). P3: e-Invoice IRP provider integration, subscription provider, loyalty/analytics.

No code changed.
