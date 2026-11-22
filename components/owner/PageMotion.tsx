'use client';

/**
 * The dashboard's arrival.
 *
 * WHY THIS IS NOT A `<motion.div>` WITH `initial={{ opacity: 0 }}`
 *
 * Because that is the one motion pattern that can delete a page. `initial`
 * is written into the server-rendered markup, so if the JavaScript chunk never
 * arrives -- a blocked bundle, a failed hydration, a browser that gave up --
 * the content stays at opacity 0 forever. The page is then blank while the
 * network tab looks healthy. `components/SiteMotion.tsx` learned the same
 * lesson on the marketing site and documents it at length; this file follows
 * the same rule instead of learning it twice.
 *
 * So the server sends the FINAL state: no class, opacity 1, no transform. Only
 * after mount is the stagger class added, and only the wrapper's class is
 * written -- never a child's inline style.
 *
 * WHY CSS AND NOT framer-motion ANY MORE
 *
 * React streams the page and hydrates it in segments. A mount effect that
 * animates each child wrote `transform: translateY(12px)` onto elements that
 * had not been hydrated yet, and hydration reported a mismatch on every staff
 * page. A class on the wrapper (hydrated first) plus `@keyframes pm-rise` in
 * globals.css keeps React's DOM untouched: children are animated by the
 * stylesheet, not by JavaScript poking at them. It also drops framer-motion
 * from every dashboard route's payload.
 *
 * The stagger is capped at six steps, 38ms apart: past six the last panel
 * arrives after the person has already read it, and the page feels slow rather
 * than composed -- the same reasoning as Reveal's eight-step cap.
 *
 * WHAT IT MUST NEVER DO
 *
 * Sit between a click and a write. It does not wrap a form's submit path, it
 * does not gate rendering on an animation, and it cannot delay a server action
 * -- it animates boxes that already contain the result.
 *
 * Reduced motion is handled in the stylesheet: the animation exists only under
 * `prefers-reduced-motion: no-preference`, so the page simply appears.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export function PageMotion({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Remove, flush, re-add: the shell survives client navigation, and a class
    // that is already present would not restart the animation for the new page.
    node.classList.remove('pm-enter');
    void node.offsetWidth;
    node.classList.add('pm-enter');

    return () => node.classList.remove('pm-enter');
    // Re-running on pathname is what makes this a *page* transition.
  }, [pathname]);

  return <div ref={ref}>{children}</div>;
}
