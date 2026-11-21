'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { DashboardBar } from '@/components/DashboardBar';
import { isWideSection, sectionForPathname } from '@/components/shell-links';
import type { OutletBar } from '@/lib/outlets';
import { PageMotion } from '@/components/owner/PageMotion';

/**
 * The staff shell, mounted once.
 *
 * WHY A LAYOUT AND NOT A COMPONENT EACH SCREEN RENDERS
 *
 * Every staff screen used to render `OwnerPage` itself. That kept the rail on
 * screen, but it meant the rail was thrown away and rebuilt on every
 * navigation: its drawer state, its "Go to…" query, its scroll and its focus
 * went with it, the venue was fetched again per page, and the arrival animation
 * replayed over the navigation as well as the content.
 *
 * It also meant the shell was a convention rather than a guarantee. A screen
 * that forgot to render it -- or an error boundary that replaced the document
 * -- took the navigation away, and a person lost their way out of the screen
 * they were on.
 *
 * So the rail is rendered here, by `app/(staff)/layout.tsx`, and the pages
 * below it render only their own content. React keeps this component mounted
 * across a navigation in the same segment, which is the whole point: the rail
 * cannot flicker, cannot be forgotten, and survives a crash in the page.
 *
 * WHY THE CURRENT SECTION COMES FROM THE URL
 *
 * A layout does not re-run when the page changes, so it cannot be handed a prop
 * by the page. `usePathname()` is the one value that is always current and
 * always true, and `sectionForPathname` turns it into the rail's answer --
 * longest match, segment-aware, so `/dashboard/menus/import` is Import and
 * `/kitchen` never matches `/kitchenette`.
 *
 * WHY THE WIDTH IS ALSO FROM THE URL
 *
 * The content width belongs to the frame, and the frame is here. Deriving it
 * from the path keeps the one wide thing (a report table, a ticket grid) wide
 * without threading a `wide` prop through a layout that cannot receive it.
 */

/** True while rendering inside the mounted shell. Read by `OwnerPage`. */
const StaffShellContext = createContext(false);

/**
 * Is this screen already inside the shell?
 *
 * The screens are also rendered standalone -- in unit tests, and in the few
 * places a screen is composed by hand. They must keep working there, so
 * `OwnerPage` renders the whole frame when the answer is false and only the
 * content frame when it is true.
 */
export function useInStaffShell(): boolean {
  return useContext(StaffShellContext);
}

export function StaffShell({
  outlet,
  signOut = true,
  children,
}: {
  outlet?: OutletBar | null;
  /** Off where there is nobody signed in to sign out of. */
  signOut?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const wide = isWideSection(pathname);

  return (
    <StaffShellContext.Provider value={true}>
      <div data-surface="owner" className="min-h-dvh bg-paper text-gink antialiased">
        {/*
         * `active` is left to the bar, which derives it from this same path.
         * Passing it here as well would be a second source of truth for the one
         * thing this refactor exists to make single.
         */}
        <DashboardBar outlet={outlet} signOut={signOut} />
        <div className="lg:pl-[244px]">
          <main
            className={[
              'mx-auto w-full px-5 pt-7 pb-24 sm:px-8 lg:pt-10',
              wide ? 'max-w-[1380px]' : 'max-w-[1240px]',
            ].join(' ')}
            /* The page's own current section, for anything that needs it
               without a React context (an error boundary, a test). */
            data-shell-active={sectionForPathname(pathname) ?? ''}
          >
            {/*
             * The arrival, not the layout. PageMotion sends its final state
             * from the server and animates from keyframes only once the client
             * is alive, so a blocked bundle leaves a visible page rather than
             * an invisible one.
             */}
            <PageMotion>{children}</PageMotion>
          </main>
        </div>
      </div>
    </StaffShellContext.Provider>
  );
}
