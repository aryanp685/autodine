'use client';

/**
 * The chart draws itself, once, on arrival.
 *
 * This is the second of the two GSAP surfaces on the owner side (the first is
 * the rail's drawer stagger), and it earns its place for the same reason: it is
 * a sequence, not a state. A line that is revealed left to right by a mapped
 * stroke is a timeline — dash offset over 700ms on one easing, with the wash
 * under it arriving a beat later and the peak dot landing at the end. CSS can
 * animate a property; it cannot choreograph three properties against one clock.
 *
 * IT CANNOT HIDE THE DATA.
 *
 * The dash offset is applied *by this file, at the moment the animation starts*.
 * The server sends a plain, fully drawn polyline. So:
 *   - JavaScript blocked        -> the chart is simply there, complete.
 *   - GSAP chunk never arrives  -> same.
 *   - animation interrupted     -> `context.revert()` puts the inline styles
 *                                  back to nothing, and the line is whole.
 * A chart that starts at `opacity: 0` in the markup is a chart that can be
 * blank for a real user; that is the bug this project already shipped once on
 * the marketing home page and refuses to ship again.
 *
 * Reduced motion is checked before the import, exactly as in useRailStagger.
 */

import { useEffect, useRef } from 'react';

export function ChartMotion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const line = root.querySelector<SVGPolylineElement>('polyline');
    // No path, no animation. This is not an error: a flat, empty series draws
    // no line at all, and a missing element must never throw on the dashboard.
    if (!line) return;

    let cancelled = false;
    let revert: (() => void) | null = null;

    void (async () => {
      try {
        const { gsap } = await import('gsap');
        if (cancelled) return;

        const context = gsap.context(() => {
          /* getTotalLength() is the honest length of THIS path, whatever the
             series was. A fixed dash constant would leave a short line half
             drawn and a long one cropped. */
          const length = line.getTotalLength();

          const timeline = gsap.timeline({
            defaults: { ease: 'power2.out' },
            // Hand every element back to the stylesheet once the sequence ends,
            // so a re-render (or a client navigation back to this screen) starts
            // from the same place as the first visit.
            onComplete: () => gsap.set([line], { clearProps: 'strokeDasharray,strokeDashoffset' }),
          });

          timeline
            .fromTo(
              line,
              { strokeDasharray: length, strokeDashoffset: length },
              { strokeDashoffset: 0, duration: 0.72 },
            )
            .fromTo(
              root.querySelector('[data-area]'),
              { opacity: 0 },
              { opacity: 1, duration: 0.5 },
              0.12,
            )
            .fromTo(
              root.querySelector('[data-peak]'),
              { opacity: 0, scale: 0.4, transformOrigin: '50% 50%' },
              { opacity: 1, scale: 1, duration: 0.34, ease: 'back.out(2)' },
              0.58,
            );
        }, root);

        revert = () => context.revert();
      } catch {
        // A failed chunk leaves the chart exactly as the server drew it:
        // complete. There is nothing for the person at the counter to do about
        // a missing chunk, so nothing is surfaced.
      }
    })();

    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
