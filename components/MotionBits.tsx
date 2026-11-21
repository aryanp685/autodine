'use client';

/**
 * Small motion primitives shared by the guest screens.
 *
 * WHY THIS FILE EXISTS
 *
 * The guest flow mixes server screens (the placed-order page reads the
 * database while it renders) with client screens. framer-motion is a client
 * library -- importing it straight into a server screen would pull hooks into
 * the server graph. The server screens reach motion through these wrappers
 * instead: serializable props in, a motion component out.
 *
 * CALM BY DEFAULT
 *
 * Every primitive checks `prefers-reduced-motion` and quietly renders still
 * markup for a guest who asked their system for calm. Motion here is garnish;
 * nothing on the guest flow depends on an animation finishing to be usable.
 */

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Fade up and settle. The workhorse entrance of the guest flow.
 *
 * `inView` waits until the block scrolls into view (once) instead of firing
 * on mount -- for blocks below the fold, entrance on mount is animation the
 * guest never sees and a jump they do.
 */
export function FadeUp({
  delay = 0,
  inView = false,
  className,
  children,
}: {
  delay?: number;
  inView?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const on = !reduce;
  return (
    <motion.div
      className={className}
      initial={on ? { opacity: 0, y: 16 } : false}
      animate={!inView && on ? { opacity: 1, y: 0 } : undefined}
      whileInView={inView && on ? { opacity: 1, y: 0 } : undefined}
      viewport={{ once: true, margin: '-32px 0px' }}
      transition={{ duration: 0.5, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The same entrance for list rows, where the row itself must stay an `<li>`.
 * The wrapper is a plain box around the row's content, so the list markup
 * keeps its shape.
 */
export function FadeUpItem({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const on = !reduce;
  return (
    <motion.div
      className={className}
      initial={on ? { opacity: 0, y: 12 } : false}
      animate={on ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.45, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A spring pop: something landed, and it should feel like it landed.
 *
 * A touch of overshoot is deliberate -- this is the one place in the flow
 * where a little bounce is honest (a tick mark, a count that changed).
 */
export function PopIn({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const on = !reduce;
  return (
    <motion.span
      className={className}
      initial={on ? { scale: 0.4, opacity: 0 } : false}
      animate={on ? { scale: 1, opacity: 1 } : undefined}
      transition={{ type: 'spring', stiffness: 440, damping: 17, delay }}
    >
      {children}
    </motion.span>
  );
}

/**
 * The dock bar rising into place. Same gesture on every screen it appears,
 * so the bottom of the flow feels like one piece of chrome.
 */
export function SpringUp({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const on = !reduce;
  return (
    <motion.div
      className={className}
      initial={on ? { y: 22, opacity: 0 } : false}
      animate={on ? { y: 0, opacity: 1 } : undefined}
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
    >
      {children}
    </motion.div>
  );
}
