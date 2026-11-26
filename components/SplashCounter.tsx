'use client';

/**
 * Signature loading screen — the premium 0→100% counter.
 *
 * Rendered by the ROOT LAYOUT on the server, so the veil is on the very
 * first paint (no spinnerless gap, ever). Whether it plays:
 *
 * - First visit in the session: it counts 0→100 and lifts away.
 * - Repeat visits: the inline script in `<head>` has already put
 *   `splash-seen` on <html> before paint, and CSS hides `[data-splash]`
 *   outright; the component also checks sessionStorage on mount and
 *   unmounts itself. Either path, no flash.
 * - Slow loads elsewhere in the app: `<SiteLoader>` re-renders it with
 *   `force` when a route takes too long — sessionStorage is ignored then.
 *
 * The component marks the session as "seen" the moment it mounts, so a
 * visitor who closes the tab mid-count does not see it twice.
 */

import { useEffect, useRef, useState } from 'react';
import { BrandLockup } from '@/components/BrandMark';

export function SplashCounter({ force = false, minMs = 2800 }: { force?: boolean; minMs?: number }) {  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    // Repeat visit: the CSS has already hidden the veil; just unmount.
    if (!force) {
      try {
        if (window.sessionStorage.getItem('autodine.splash.seen')) {
          setGone(true);
          return;
        }
      } catch {
        /* storage unavailable — play the splash */
      }
    }
    try {
      window.sessionStorage.setItem('autodine.splash.seen', '1');
    } catch {
      /* nothing to remember */
    }

    const started = performance.now();
    let raf = 0;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      setLeaving(true);
      setTimeout(() => setGone(true), 620);
    };
    const tick = (now: number) => {
      // Ease-out: fast to ~90, then crawls — reads as real loading.
      const t = Math.min(1, (now - started) / minMs);
      const eased = 1 - Math.pow(1 - t, 2.4);
      setPct(Math.round(eased * 100));
      if (t < 1) raf = requestAnimationFrame(tick);
      else finish();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [force, minMs]);

  if (gone) return null;

  return (
    <div
      data-splash
      role="status"
      aria-label="Loading AutoDine"
      className={[
        'fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[linear-gradient(160deg,#fdf8f0_0%,#f6efe1_58%,#eee3cd_100%)] transition-[opacity,transform] duration-600 ease-[cubic-bezier(0.22,1,0.36,1)]',
        leaving ? 'pointer-events-none -translate-y-3 opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 size-[420px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,112,37,0.12),transparent_65%)]" />

      <div className="relative grid size-[128px] place-items-center">
        <svg viewBox="0 0 128 128" aria-hidden="true" className="absolute inset-0 size-full -rotate-90">
          <circle cx="64" cy="64" r="58" fill="none" stroke="rgba(23,72,61,0.1)" strokeWidth="3" />
          <circle
            cx="64"
            cy="64"
            r="58"
            fill="none"
            stroke="#17483d"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 58}
            strokeDashoffset={2 * Math.PI * 58 * (1 - pct / 100)}
            style={{ transition: 'stroke-dashoffset 120ms linear' }}
          />
        </svg>
        <BrandLockup size={34} ink="#17483d" dot="#ff7025" />
      </div>

      <p className="mt-7 text-[30px] font-bold tabular-nums tracking-[-0.03em] text-forest" aria-hidden="true">
        {pct}
        <span className="text-[18px] text-forest/60">%</span>
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-forest/60">
        Setting your table…
      </p>

      <div aria-hidden="true" className="mt-6 h-1 w-44 overflow-hidden rounded-full bg-forest/10">
        <div className="h-full rounded-full bg-brass transition-[width] duration-150 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
