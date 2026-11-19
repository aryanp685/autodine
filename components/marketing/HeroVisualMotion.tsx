'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * The hero visual's motion. GSAP still owns the copy reveal for the landing
 * page (SiteMotion, with its no-JS and watchdog behaviour); framer-motion is
 * used here for the product composition because it is a client island whose
 * entrance must not depend on a scroll trigger.
 */
export function HeroVisualMotion({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 28, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.95, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
    >
      {children}
    </motion.div>
  );
}

export function PhoneFloat({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      animate={reduce ? undefined : { y: [0, -9, 0] }}
      transition={reduce ? undefined : { duration: 9, ease: 'easeInOut', repeat: Infinity }}
    >
      {children}
    </motion.div>
  );
}
