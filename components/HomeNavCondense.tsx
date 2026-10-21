'use client';

/**
 * Condenses the landing-page bar once the page starts moving.
 *
 * Renders nothing and finds the server-rendered nav by class, so the nav markup
 * stays a Server Component and does not ship to the browser as JavaScript --
 * only this nine-line effect does. The alternative, making the whole nav a
 * client component, would have moved the entire header into the hydration
 * payload to toggle one class name.
 *
 * WHY A STATE THRESHOLD AND NOT A SCROLL LISTENER ON EVERY PIXEL
 *
 * scrollY is read at most once per animation frame, and the class is only
 * written when the boolean actually changes, so a long scroll costs one
 * setAttribute per threshold crossing. The listener is passive: it never calls
 * preventDefault, so it cannot delay the scroll itself.
 *
 * If JavaScript never runs, the nav simply keeps its resting size. Nothing is
 * hidden, nothing is missing -- condensing is an enhancement, not a state the
 * page depends on.
 */

import { useEffect } from 'react';

/** A few pixels, not zero: the hero's top edge should not flicker the bar. */
const CONDENSE_AFTER_PX = 16;

export function HomeNavCondense() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.home__nav');
    if (!nav) return;

    let frame = 0;
    let condensed = false;

    const apply = () => {
      frame = 0;
      const next = window.scrollY > CONDENSE_AFTER_PX;
      if (next === condensed) return;
      condensed = next;
      nav.classList.toggle('is-condensed', next);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    // Restored scroll positions (a refresh halfway down the page) start mid-air;
    // read once so the bar matches the page before the first scroll event.
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      nav.classList.remove('is-condensed');
    };
  }, []);

  return null;
}
