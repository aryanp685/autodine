'use client';

import { useEffect, type RefObject } from 'react';
import { BRAND_HANDOFF_KEY } from '@/components/AuthHandoffLink';

type Record = { x: number; y: number; w: number; h: number; t: number };

/** A handoff older than this is stale: a reload or a slow route is not a
 *  shared element, and animating from it would look like a bug. */
const MAX_AGE_MS = 3000;

/**
 * Animates the account header's lockup from where the marketing lockup was
 * when the visitor clicked. The record is consumed once, and only from the
 * element that carries `data-brand-handoff`, so a reload never replays it.
 */
export function useBrandHandoff(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    // StrictMode remounts effects but keeps the DOM node, so the marker on the
    // element — not a cancelled cleanup — is what keeps the play to one.
    if (!el || el.dataset.brandHandoffPlayed) return;

    let from: Record;
    try {
      const raw = sessionStorage.getItem(BRAND_HANDOFF_KEY);
      if (!raw) return;
      sessionStorage.removeItem(BRAND_HANDOFF_KEY);
      from = JSON.parse(raw) as Record;
    } catch {
      return;
    }
    el.dataset.brandHandoffPlayed = 'true';
    if (Date.now() - from.t > MAX_AGE_MS) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) return;

    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const scale = from.w / to.width;
    el.animate(
      [
        { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.4 },
        { transformOrigin: 'top left', transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ],
      { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }, [ref]);
}
