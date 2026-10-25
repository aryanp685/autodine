'use client';

/**
 * A small stagger for a list or a row of cards.
 *
 * WHY IT IS SAFE ENOUGH TO PUT IN THE PRODUCT
 *
 * The server sends the final state. There is no `initial={{ opacity: 0 }}` in
 * the markup, so a blocked bundle, a failed hydration or a browser that gave up
 * leaves a page you can read -- the only loss is the 160ms of movement. This is
 * the same rule as PageMotion, and it is the reason both exist as components
 * rather than as `motion.div` literals scattered through the screens.
 *
 * HOW IT ANIMATES
 *
 * The wrapper walks its direct children once on mount and animates each from a
 * keyframe array (`opacity: [0, 1]`, `y: [6, 0]`) with a 35ms stagger, capped at
 * eight steps so a twelve-table floor does not take a second and a half to
 * settle. Transform and opacity only: no layout, no reflow, nothing that can
 * make a tap land in the wrong place.
 *
 * The element is never disabled, never covers its children, and takes no part
 * in any write -- a kitchen board that animated its way through a status change
 * would be a board that could lose an order behind an animation.
 *
 * Reduced motion is honoured at mount, so the children simply appear.
 */

import { animate } from 'framer-motion';
import { useEffect, useRef } from 'react';

export function Reveal({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  /** Keeps the DOM honest: a list stays a list. */
  as?: 'div' | 'ul' | 'ol' | 'section';
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const items = Array.from(node.children) as HTMLElement[];
    if (items.length === 0) return;

    const controls = items.slice(0, 14).map((item, index) =>
      animate(
        item,
        // A card arrives at 10px with a hair of scale. The scale is what makes
        // a grid of cards read as laid down one at a time rather than slid up as
        // a block; 0.985 is small enough that nothing inside it can shift by a
        // pixel a finger would aim at, and it is transform-only.
        { opacity: [0, 1], y: [10, 0], scale: [0.985, 1] },
        {
          duration: 0.3,
          // Eight steps of stagger however many cards there are: past that the
          // last one arrives after the person has already looked at it.
          delay: Math.min(index, 8) * 0.03,
          ease: [0.2, 0.7, 0.2, 1],
        },
      ),
    );

    return () => controls.forEach((control) => control.stop());
  }, []);

  return (
    <Tag ref={ref as React.Ref<never>} className={className}>
      {children}
    </Tag>
  );
}
