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
 * So the server sends the FINAL state: opacity 1, no transform. On mount, and
 * only then, the element is animated from a keyframe array -- `opacity: [0, 1]`
 * rather than `0 -> 1`. If the animation never runs, nothing was ever hidden;
 * the only loss is the 300ms of polish.
 *
 * WHAT MOVES NOW, AND WHY IT CHANGED
 *
 * The first version moved the whole content column 6px. On a screen with a
 * hero, a row of figures and four panels that is one object sliding, which
 * reads as a page transition from 2014. What reads as a designed surface is a
 * SHORT STAGGER down the page: the head arrives, then the figures, then the
 * panels, each 12px and 320ms, 38ms apart, on one curve.
 *
 * It is capped at six steps. Past six the last panel arrives after the person
 * has already read it, and the page feels slow rather than composed -- the
 * same reasoning as Reveal's eight-step cap on a list of cards.
 *
 * WHAT IT MUST NEVER DO
 *
 * Sit between a click and a write. It does not wrap a form's submit path, it
 * does not gate rendering on `onAnimationComplete`, and it cannot delay a
 * server action -- it animates boxes that already contain the result. The
 * children are in the DOM whether or not a single frame runs.
 *
 * Reduced motion is checked at mount, not in CSS, because the decision belongs
 * to the animation engine here: with `prefers-reduced-motion: reduce` the effect
 * returns before any frame is scheduled and the page simply appears.
 *
 * COST
 *
 * `animate` from framer-motion is already in every dashboard route's payload
 * for this component (measured when it was introduced: 20.9 KB gzip, once per
 * session, content-hashed). Nothing here adds a second runtime: GSAP stays on
 * the marketing site, and the drawer, the rail, the scrim and every hover
 * state remain CSS, which costs no JavaScript at all.
 */

import { animate } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Children past the sixth arrive with it: a 12-card floor is not a queue. */
const MAX_STEPS = 6;

export function PageMotion({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Somebody who asked the system for less motion meant it.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;

    const steps = Array.from(node.children) as HTMLElement[];
    if (steps.length === 0) return;

    const controls = steps.map((step, index) =>
      animate(
        step,
        { opacity: [0, 1], y: [12, 0] },
        {
          duration: 0.32,
          delay: Math.min(index, MAX_STEPS) * 0.038,
          ease: [0.2, 0.7, 0.2, 1],
        },
      ),
    );

    // A navigation that unmounts mid-fade must not leave a half-faded box, and
    // must not keep ticking: `stop()` also clears the pending frame.
    return () => controls.forEach((control) => control.stop());
    // Re-running on pathname is what makes this a *page* transition: the shell
    // (and this wrapper) survive client navigation, so without the dependency
    // the second page would arrive with no movement at all.
  }, [pathname]);

  return <div ref={ref}>{children}</div>;
}
