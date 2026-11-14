# Route / feature verification inventory

Generated from the current repository, not inferred from marketing. Route groups in parentheses do not appear in URLs. `[id]` and `[slug]` need real fixtures for persisted workflows.

**Coverage limit:** source/build inclusion is not verification of every button. Group-level local/native/browser evidence and live blockers are in [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md). Each authenticated route still needs the disposable Supabase lifecycle/relogin and role matrix acceptance; neither this inventory nor demo browser coverage certifies that.

**Current local pricing regression (Arena date 2026-11-06 UTC):** `/menu/cart` and `/menu/checkout` load item add-on groups and prices before showing a total. If either read fails, `getCartScreenData` now throws a fixed error rather than returning a lower, incomplete quote. `lib/db/cart-screen.test.ts` covers both failures and the successful price mapping. This is local loader evidence only; it does not verify hosted order persistence or a live guest-to-staff journey.

## Pages (42)

| URL pattern | Source | Acceptance dependency |
|---|---|---|
| `/dashboard/display` | `app/(kiosk)/dashboard/display/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/cashier` | `app/(staff)/cashier/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/branding` | `app/(staff)/dashboard/branding/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/branding/preview` | `app/(staff)/dashboard/branding/preview/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/menus/import` | `app/(staff)/dashboard/menus/import/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/menus` | `app/(staff)/dashboard/menus/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/menus/translate` | `app/(staff)/dashboard/menus/translate/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/menus/translate/print` | `app/(staff)/dashboard/menus/translate/print/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/orders` | `app/(staff)/dashboard/orders/page.tsx` | Owner/Manager use report-backed finance rows; Cashier UI uses an orders-only projection, but Production catalog confirms RLS enabled (not forced) and `authenticated` can SELECT all 25 columns, including finance fields and `guest_token`, under member-only RLS, not role-filtered. `anon` has SELECT ACLs but no SELECT policy/bypass. The projection is not a database finance or guest-token boundary; see the hardening report. |
| `/dashboard` | `app/(staff)/dashboard/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/invoices` | `app/(staff)/dashboard/invoices/page.tsx` | Finance role/tenant + immutable invoice history; disposable DB + role/RLS matrix |
| `/dashboard/reports` | `app/(staff)/dashboard/reports/page.tsx` | Screen, export handler, and `report_sales()` independently require Owner/Manager; route and disposable-PostgreSQL role/export-limit regressions pass. Direct `orders` table reads remain a separate broader grant/RLS issue; see the hardening report. |
| `/dashboard/subscription` | `app/(staff)/dashboard/subscription/page.tsx` | Owner/Manager route gate; owner-only Server Actions and cancellation RPC. Provider stays disabled. Billing read RPCs and table RLS remain account-member-scoped for direct authenticated calls; decide whether that role scope is intended. |
| `/dashboard/subscription/receipt/[id]` | `app/(staff)/dashboard/subscription/receipt/[id]/page.tsx` | Owner/Manager route gate; immutable receipt RPC and table RLS remain account-member-scoped at the database boundary. Direct-call role visibility needs owner decision. |
| `/dashboard/settings` | `app/(staff)/dashboard/settings/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/tables` | `app/(staff)/dashboard/tables/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/kitchen` | `app/(staff)/kitchen/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/admin/renew-trial` | `app/admin/renew-trial/page.tsx` | Operator authorization + real staging-only action; no production operation performed |
| `/bill/[id]` | `app/bill/[id]/page.tsx` | Signed-in staff path; selected-outlet bill read; disposable DB role/RLS matrix (including kitchen vs cashier) |
| `/demo/menu` | `app/demo/menu/page.tsx` | Public demo/render/browser coverage; any commercial claim needs factual approval |
| `/forgot-password` | `app/forgot-password/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/invoice/[id]` | `app/invoice/[id]/page.tsx` | Signed-in staff; selected-outlet invoice and finance-RLS scope; disposable DB role/RLS matrix |
| `/invoice/payment/[id]` | `app/invoice/payment/[id]/page.tsx` | Signed-in staff; selected-outlet payment receipt and finance-RLS scope; disposable DB role/RLS matrix |
| `/join/[code]` | `app/join/[code]/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/join` | `app/join/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/login` | `app/login/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/menu/cart` | `app/menu/cart/page.tsx` | Live QR card/session gate; cart is local; checkout/action must reject orders without verified session; native money/session coverage |
| `/menu/checkout` | `app/menu/checkout/page.tsx` | Live QR card/session gate; order write requires verified session and server pricing; native money/session coverage |
| `/menu/item` | `app/menu/item/page.tsx` | Live QR card/session gate; published-menu item lookup; cart remains client-side; native money/session coverage |
| `/menu/order` | `app/menu/order/page.tsx` | Guest bearer token plus slug/code; loader rejects malformed UUID tokens before RPC, and DB token checks govern reads/mutations. Token remains in the URL; no-store does not remove history/log exposure. |
| `/menu/orders` | `app/menu/orders/page.tsx` | Public page reads the guest's browser-stored order references; individual order reads require that order's bearer token; native money/session coverage |
| `/menu` | `app/menu/page.tsx` | Live QR card or verified table-session gate; public published menu after server-side card/session resolution; native money/session coverage |
| `/` | `app/page.tsx` | Public demo/render/browser coverage; any commercial claim needs factual approval |
| `/pricing` | `app/pricing/page.tsx` | Public demo/render/browser coverage; any commercial claim needs factual approval |
| `/privacy` | `app/privacy/page.tsx` | Public demo/render/browser coverage; any commercial claim needs factual approval |
| `/receipt-share/[token]` | `app/receipt-share/[token]/page.tsx` | Unauthenticated bearer link; token expiry/revocation and per-token read budget; synthetic-only test |
| `/reset-password` | `app/reset-password/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/signup` | `app/signup/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/signup/confirmation-pending` | `app/signup/confirmation-pending/page.tsx` | Public confirmation guidance; Auth delivery/callback remains a hosted acceptance dependency |
| `/t/[token]/code` | `app/t/[token]/code/page.tsx` | Public QR-token lookup; rotating code verification and attempt budget in DB; session cookie only after successful verification |
| `/t/problem` | `app/t/problem/page.tsx` | Public fixed explanation selected from an allowlisted reason; no tenant or bearer data |
| `/terms` | `app/terms/page.tsx` | Public static legal content; render/accessibility check only; factual/legal copy requires owner approval |

## Route handlers (11)

| Endpoint | Source | Verification boundary |
|---|---|---|
| `/dashboard/outlet/new` | `app/(staff)/dashboard/outlet/new/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/dashboard/outlet` | `app/(staff)/dashboard/outlet/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/dashboard/reports/export` | `app/(staff)/dashboard/reports/export/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/api/admin/renew-trial` | `app/api/admin/renew-trial/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/api/billing/webhook` | `app/api/billing/webhook/route.ts` | Signed/fresh provider event, replay-safe; provider remains unconfigured; no live callback test |
| `/api/health` | `app/api/health/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/api/ops/realtime-alert` | `app/api/ops/realtime-alert/route.ts` | Staff kitchen role + tenant budget; unit coverage does not prove hosted alert delivery |
| `/api/tts` | `app/api/tts/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/auth/confirm` | `app/auth/confirm/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/menu/orders/status` | `app/menu/orders/status/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/t/[token]` | `app/t/[token]/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |

## Static metadata routes (1)

| URL | Source | Verification boundary |
|---|---|---|
| `/manifest.webmanifest` | `app/manifest.ts` | Static public install metadata; no tenant data or authentication; browser installability check remains separate |

## Cross-cutting controls not proven by page rendering

Server Actions, database RPCs, RLS/grants, Storage policies, provider callbacks, authorization after relogin, retries/network failure, simultaneous payment/cancel/close, email delivery, actual printer/PDF/share, all-browser accessibility and performance need separate evidence. The native suite proves its listed SQL assertions; it is not a full Supabase deployment. New CI recovery jobs remain unrun. No complete per-control live certification is claimed.
