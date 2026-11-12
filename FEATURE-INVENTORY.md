# Route / feature verification inventory

Generated from the current repository, not inferred from marketing. Route groups in parentheses do not appear in URLs. `[id]` and `[slug]` need real fixtures for persisted workflows.

**Coverage limit:** source/build inclusion is not verification of every button. Group-level local/native/browser evidence and live blockers are in [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md). Each authenticated route still needs the disposable Supabase lifecycle/relogin and role matrix acceptance; neither this inventory nor demo browser coverage certifies that.

**Current local pricing regression (Arena date 2026-11-06 UTC):** `/menu/cart` and `/menu/checkout` load item add-on groups and prices before showing a total. If either read fails, `getCartScreenData` now throws a fixed error rather than returning a lower, incomplete quote. `lib/db/cart-screen.test.ts` covers both failures and the successful price mapping. This is local loader evidence only; it does not verify hosted order persistence or a live guest-to-staff journey.

## Pages (37)

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
| `/dashboard/orders` | `app/(staff)/dashboard/orders/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard` | `app/(staff)/dashboard/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/reports` | `app/(staff)/dashboard/reports/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/settings` | `app/(staff)/dashboard/settings/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/dashboard/tables` | `app/(staff)/dashboard/tables/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/kitchen` | `app/(staff)/kitchen/page.tsx` | Staff role/tenant + persistence; demo responsive suite covers selected screens |
| `/admin/renew-trial` | `app/admin/renew-trial/page.tsx` | Operator authorization + real staging-only action; no production operation performed |
| `/bill/[id]` | `app/bill/[id]/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/demo/menu` | `app/demo/menu/page.tsx` | Public demo/render/browser coverage; any commercial claim needs factual approval |
| `/forgot-password` | `app/forgot-password/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/invoice/[id]` | `app/invoice/[id]/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/invoice/payment/[id]` | `app/invoice/payment/[id]/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/join/[code]` | `app/join/[code]/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/join` | `app/join/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/login` | `app/login/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/menu/cart` | `app/menu/cart/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/menu/checkout` | `app/menu/checkout/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/menu/item` | `app/menu/item/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/menu/order` | `app/menu/order/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/menu/orders` | `app/menu/orders/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/menu` | `app/menu/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/` | `app/page.tsx` | Public demo/render/browser coverage; any commercial claim needs factual approval |
| `/pricing` | `app/pricing/page.tsx` | Public demo/render/browser coverage; any commercial claim needs factual approval |
| `/privacy` | `app/privacy/page.tsx` | Public demo/render/browser coverage; any commercial claim needs factual approval |
| `/reset-password` | `app/reset-password/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/signup` | `app/signup/page.tsx` | Real Auth/email/redirect/relogin; local form tests only are insufficient |
| `/t/[token]/code` | `app/t/[token]/code/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/t/problem` | `app/t/problem/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |
| `/terms` | `app/terms/page.tsx` | Guest token/session or staff receipt authorization; native money/session coverage + selected demo browsers |

## Route handlers (9)

| Endpoint | Source | Verification boundary |
|---|---|---|
| `/dashboard/outlet/new` | `app/(staff)/dashboard/outlet/new/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/dashboard/outlet` | `app/(staff)/dashboard/outlet/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/dashboard/reports/export` | `app/(staff)/dashboard/reports/export/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/api/admin/renew-trial` | `app/api/admin/renew-trial/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/api/health` | `app/api/health/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/api/tts` | `app/api/tts/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/auth/confirm` | `app/auth/confirm/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/menu/orders/status` | `app/menu/orders/status/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |
| `/t/[token]` | `app/t/[token]/route.ts` | Unit/native coverage where present; real service HTTP integration not blanket-certified |

## Cross-cutting controls not proven by page rendering

Server Actions, database RPCs, RLS/grants, Storage policies, provider callbacks, authorization after relogin, retries/network failure, simultaneous payment/cancel/close, email delivery, actual printer/PDF/share, all-browser accessibility and performance need separate evidence. The native suite proves its listed SQL assertions; it is not a full Supabase deployment. New CI recovery jobs remain unrun. No complete per-control live certification is claimed.
