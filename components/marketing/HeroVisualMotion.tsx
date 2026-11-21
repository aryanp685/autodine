'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The hero visual's motion. GSAP still owns the copy reveal for the landing
 * page (SiteMotion, with its no-JS and watchdog behaviour); framer-motion is
 * used here for the product composition because it is a client island whose
 * entrance must not depend on a scroll trigger.
 *
 * The inner wrapper is the 3D layer: a fine pointer anywhere over the hero
 * leans the composition a few degrees towards it. The angle is written as two
 * custom properties and CSS owns the transform, so there is no React state and
 * nothing to hydrate wrong. Reduced motion, touch screens and data-saver
 * visitors get the still composition -- which is all that is lost.
 */
export function HeroVisualMotion({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const tilt = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = tilt.current;
    if (!node) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const area = node.closest<HTMLElement>('[data-hero]') ?? node;
    let frame = 0;
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    const write = () => {
      frame = 0;
      current.x += (target.x - current.x) * 0.12;
      current.y += (target.y - current.y) * 0.12;
      node.style.setProperty('--tilt-x', `${(-current.y * 3.2).toFixed(2)}deg`);
      node.style.setProperty('--tilt-y', `${(current.x * 3.8).toFixed(2)}deg`);
      if (Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001) {
        frame = requestAnimationFrame(write);
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };

    const onPointer = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      target.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      target.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      schedule();
    };

    const reset = () => {
      target.x = 0;
      target.y = 0;
      schedule();
    };

    area.addEventListener('pointermove', onPointer as EventListener, { passive: true });
    area.addEventListener('pointerleave', reset);

    return () => {
      cancelAnimationFrame(frame);
      area.removeEventListener('pointermove', onPointer as EventListener);
      area.removeEventListener('pointerleave', reset);
      node.style.removeProperty('--tilt-x');
      node.style.removeProperty('--tilt-y');
    };
  }, []);

  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 28, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.95, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
    >
      <div ref={tilt} className="hero-tilt">
        {children}
      </div>
    </motion.div>
  );
}
