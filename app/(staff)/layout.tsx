import type { ReactNode } from 'react';
import { StaffShell } from '@/components/owner/StaffShell';
import { getOutletBar } from '@/lib/db/outlet-bar';
import { isSupabaseConfigured } from '@/lib/supabase/env';

/**
 * The staff application's one shell.
 *
 * WHY A LAYOUT, AT LAST
 *
 * Every staff screen used to render `OwnerPage` itself, which kept the rail on
 * screen but rebuilt it on every navigation: the drawer, the "Go to…" query,
 * scroll and focus were thrown away, the venue was fetched again per page, and
 * the arrival animation was replayed over the navigation as well as over the
 * content. The shell was a convention, not a guarantee.
 *
 * A layout is the framework's answer to exactly that: React keeps it mounted
 * across a navigation inside the same segment, so the rail is drawn once and
 * never flickers, and an error thrown by a page is caught by `error.tsx` BELOW
 * this file -- so navigation survives a crash instead of disappearing with it.
 *
 * WHY A ROUTE GROUP
 *
 * `(staff)` is in parentheses, so it contributes nothing to the URL: every
 * route keeps its exact address (`/dashboard/orders`, `/kitchen`,
 * `/cashier`), which is what keeps bookmarks, the proxy's matcher and the QR
 * flows working untouched. Presenting it as a group is the only way to share a
 * layout across three top-level segments without renaming any of them.
 *
 * WHAT IS DELIBERATELY NOT IN HERE
 *
 * `/dashboard/display` -- the guest-code board for a tablet at the counter. It
 * is a full-screen kiosk with no navigation, so it lives outside this group
 * (`app/(kiosk)`) and keeps its own frame.
 *
 * `/bill/[id]` -- the printable bill, deliberately a standalone sheet.
 *
 * AUTHENTICATION IS NOT TOUCHED. `proxy.ts` still guards `/dashboard/*`,
 * `/kitchen/*`, `/cashier/*` and `/bill/*`, refreshing the session and
 * redirecting a signed-out visitor to `/login?next=<path+search>`. This layout
 * reads the venue for the rail and nothing else; it authorises nobody, and it
 * does not weaken or duplicate a single check. The data loaders inside each
 * page still verify membership themselves.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  // Null covers both "no database configured" (the demo site) and "signed out
  // or not a member"; the rail then renders without a venue, which is honest.
  const outlet = await getOutletBar();

  /*
   * Sign-out is offered when there is somebody to sign out. With Supabase
   * configured, a null venue means exactly that -- not signed in, or not a
   * member of any restaurant -- so the control is hidden rather than offered
   * as a button that cannot do anything. Without a database (demo mode) there
   * is no session to read, and the demo screens have always shown the control.
   */
  const signOut = isSupabaseConfigured ? outlet !== null : true;

  return (
    <StaffShell outlet={outlet} signOut={signOut}>
      {children}
    </StaffShell>
  );
}
