'use client';

/**
 * The one piece of the dashboard that GSAP owns, and why it is this piece.
 *
 * The rail's rows exist already. Opening the drawer on a phone is a CSS
 * transform on the sheet, and on a laptop the rail never moves at all -- there
 * is nothing for an animation library to do about the box itself. What CSS
 * cannot do is a HEADS-TAILED ARRIVAL: nine rows landing 22ms apart on one
 * curve. `transition-delay` could fake it, but it cannot be cancelled cleanly,
 * it has no notion of a timeline, and it leaves the delay in the stylesheet
 * where the next hover state inherits it.
 *
 * So: GSAP, on the rows, and only while the drawer is open.
 *
 * THE FOUR RULES, restated here because they are the whole file
 *
 * 1. `fromTo`, never `from`. `gsap.from()` reads its end value from the
 *    computed style and this repository has already shipped a blank page that
 *    way (components/SiteMotion.tsx, components/SiteMotion.contract.test.tsx).
 *    Every tween names both ends.
 * 2. Lazily imported. GSAP is not in the shell's bundle: it arrives after the
 *    drawer has already opened, so the first open costs nothing but a chunk.
 *    Nobody can be blocked behind it -- the rows are on screen and readable
 *    before the import resolves, and if it never resolves they simply do not
 *    move.
 * 3. `gsap.context()` with a `revert()` on unmount or close. Without it an
 *    interrupted stagger leaves inline `opacity`/`transform` behind, and the
 *    second open starts from whatever the first one left.
 * 4. Reduced motion is checked before a frame is scheduled. Not in CSS --
 *    GSAP writes inline styles, which a media query cannot undo.
 *
 * The end state of every tween is the state the markup already has
 * (`clearProps` drops the inline styles when it lands), which is what makes
 * step 2 safe: failing open is the default, not an error case.
 */

import { useEffect, useRef } from 'react';

/** 22ms between rows: nine rows finish arriving in under half a second. */
const ROW_STAGGER = 0.022;

export function useRailStagger<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !open) return;

    // Asked, then honoured. A person who set this in their OS meant it.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let cancelled = false;
    let revert: (() => void) | null = null;

    void (async () => {
      try {
        const { gsap } = await import('gsap');
        // The drawer can be closed again, or the screen can navigate away,
        // while the chunk is still in flight.
        if (cancelled) return;

        const context = gsap.context(() => {
          gsap.fromTo(
            root.querySelectorAll('[data-rail-row]'),
            { opacity: 0.28, y: 9 },
            {
              opacity: 1,
              y: 0,
              duration: 0.34,
              stagger: ROW_STAGGER,
              ease: 'power3.out',
              // Hand the rows back exactly as the stylesheet describes them.
              clearProps: 'opacity,transform',
            },
          );
        }, root);

        revert = () => context.revert();
      } catch {
        // A blocked or failed chunk is not an error the person at the counter
        // can act on. The rows are already visible and readable; leave them.
      }
    })();

    return () => {
      cancelled = true;
      revert?.();
    };
  }, [open]);

  return ref;
}
