'use client';

/**
 * Slow-load loader, site-wide.
 *
 * The first-visit splash is rendered by the layout itself (see
 * SplashCounter). This component covers the other case: a route that stays
 * on its loading skeleton for over 1.2 seconds — slow internet, cold server.
 * When that happens the signature counter fades back in, with a shorter,
 * subtler run so it reads as "still working", not "start over".
 */

import { useEffect, useState } from 'react';
import { SplashCounter } from '@/components/SplashCounter';

export function SiteLoader() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const observer = new MutationObserver(() => {
      const skeleton = document.querySelector('[data-route-skeleton]');
      if (skeleton) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setSlow(true), 1200);
      } else {
        if (timer) clearTimeout(timer);
        setSlow(false);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return slow ? <SplashCounter force minMs={1400} /> : null;
}
