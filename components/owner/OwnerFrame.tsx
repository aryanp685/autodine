'use client';

import type { ReactNode } from 'react';
import { DashboardBar } from '@/components/DashboardBar';
import type { DashboardSection } from '@/components/shell-links';
import type { OutletBar } from '@/lib/outlets';
import { PageMotion } from '@/components/owner/PageMotion';
import { useInStaffShell } from '@/components/owner/StaffShell';

/**
 * The page frame, decided at render time.
 *
 * TWO WAYS THIS GETS RENDERED
 *
 *   1. Inside the mounted shell (`app/(staff)/layout.tsx` renders `StaffShell`,
 *      every staff page renders below it). Here there is nothing to draw: the
 *      rail, the `<main>`, its padding and its width are already on screen one
 *      component above. The frame is a passthrough, which is what makes the
 *      rail survive a navigation instead of being rebuilt by the page.
 *
 *   2. Standalone. A screen rendered on its own -- in a unit test, or composed
 *      by hand somewhere -- has no shell above it, so the frame supplies the
 *      whole thing exactly as it always did.
 *
 * WHY A SEPARATE CLIENT COMPONENT
 *
 * `components/owner/chrome.tsx` is a server module: the screens import the kit
 * from it, and several of those screens are server-rendered. Reading a React
 * context needs a client boundary, so the boundary is this file and `chrome.tsx`
 * stays a plain server module that composes it.
 */

export function OwnerFrame({
  active,
  outlet,
  signOut,
  wide = false,
  children,
}: {
  active?: DashboardSection;
  outlet?: OutletBar | null;
  signOut?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const inShell = useInStaffShell();

  // Inside the shell: the frame already exists one level up.
  if (inShell) return <>{children}</>;

  return (
    <div data-surface="owner" className="min-h-dvh bg-paper text-gink antialiased">
      <DashboardBar active={active} outlet={outlet} signOut={signOut} />
      <div className="lg:pl-[244px]">
        <main
          className={[
            'mx-auto w-full px-5 pt-7 pb-24 sm:px-8 lg:pt-10',
            wide ? 'max-w-[1380px]' : 'max-w-[1240px]',
          ].join(' ')}
        >
          <PageMotion>{children}</PageMotion>
        </main>
      </div>
    </div>
  );
}
