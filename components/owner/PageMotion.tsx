'use client';

/**
 * The dashboard's page-content transition.
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
 * So the server sends the FINAL state: opacity 1, no transform. On mount, and
 * only then, the element is animated from a keyframe array -- `opacity: [0, 1]`
 * rather than `0 -> 1`. If the animation never runs, nothing was ever hidden;
 * the only thing lost is the 220ms of polish.
 *
 * WHAT MOVES
 *
 * The content column, by 6px and 220ms, once per navigation. Transform and
 * opacity only, so it composites on the GPU and cannot trigger layout. No
 * stagger, no spring, no bounce: this is a screen an owner returns to forty
 * times a shift, and the fortieth time it should be a fact, not a performance.
 *
 * WHAT IT MUST NEVER DO
 *
 * Sit between a click and a write. It does not wrap forms' submit path, it
 * does not gate rendering on `onAnimationComplete`, and it cannot delay a
 * server action -- it animates a box that already contains the result.
 *
 * Reduced motion is checked at mount, not in CSS, because the decision belongs
 * to the animation engine here: with `prefers-reduced-motion: reduce` the effect
 * returns before any frame is scheduled and the page simply appears.
 *
 * COST, MEASURED
 *
 * Importing `animate` from framer-motion adds 20.9 KB gzip to every dashboard
 * route (183.1 -> 204.0 KB of route JavaScript, measured on the production
 * build for /dashboard by A/B-ing this component out). `framer-motion/dom`
 * produced byte-identical output, so the smaller entry point buys nothing. That
 * is a real price for 6px and 220ms, it is paid once per session because the
 * chunks are content-hashed, and it is the reason nothing else in the dashboard
 * gets a motion library: GSAP stays on the marketing site, and the drawer, the
 * scrim and every hover state remain CSS.
 */

import { animate } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export function PageMotion({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Somebody who asked the system for less motion meant it.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;

    const controls = animate(
      node,
      { opacity: [0, 1], y: [6, 0] },
      { duration: 0.22, ease: [0.2, 0.7, 0.2, 1] },
    );

    // A navigation that unmounts mid-fade must not leave a half-faded box, and
    // must not keep ticking: `stop()` also clears the pending frame.
    return () => controls.stop();
    // Re-running on pathname is what makes this a *page* transition: the shell
    // (and this wrapper) survive client navigation, so without the dependency
    // the second page would arrive with no movement at all.
  }, [pathname]);

  return <div ref={ref}>{children}</div>;
}
