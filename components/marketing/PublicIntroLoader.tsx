'use client';

import { useEffect, useRef, useState } from 'react';
import { BrandLockup } from '@/components/BrandMark';
import { BRAND_GREEN } from '@/lib/brand';

const SEEN_KEY = 'autodine-public-intro-seen';
const DISPLAY_MS = 2080;
const EXIT_MS = 420;

/** One soft, full-viewport welcome transition per tab session on public screens. */
export function PublicIntroLoader() {
  const [stage, setStage] = useState<'show' | 'exit' | 'off'>('show');
  const initialized = useRef(false);
  const shouldPlay = useRef(true);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      try {
        if (window.sessionStorage.getItem(SEEN_KEY)) {
          shouldPlay.current = false;
          setStage('off');
          return;
        }
        window.sessionStorage.setItem(SEEN_KEY, '1');
      } catch {
        // Storage can be blocked. The loader still behaves normally for this visit.
      }

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        shouldPlay.current = false;
        setStage('off');
        return;
      }
    }
    if (!shouldPlay.current) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const restorePage = () => { document.body.style.overflow = previousOverflow; };
    const beginExit = window.setTimeout(() => setStage('exit'), DISPLAY_MS);
    const unmount = window.setTimeout(() => {
      setStage('off');
      restorePage();
    }, DISPLAY_MS + EXIT_MS);
    return () => {
      window.clearTimeout(beginExit);
      window.clearTimeout(unmount);
      restorePage();
    };
  }, []);

  if (stage === 'off') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading AutoDine experience"
      data-public-intro
      data-stage={stage}
      data-duration="2500"
      className="public-intro-loader"
    >
      <span aria-hidden="true" className="public-intro-loader__leaf public-intro-loader__leaf--one" />
      <span aria-hidden="true" className="public-intro-loader__leaf public-intro-loader__leaf--two" />
      <div className="public-intro-loader__content">
        <BrandLockup size={46} ink="currentColor" dot={BRAND_GREEN} />
        <p className="public-intro-loader__eyebrow">A better rhythm for every table</p>
        <p className="public-intro-loader__tagline">Scan <span>·</span> Order <span>·</span> Enjoy</p>
        <div className="public-intro-loader__progress" aria-hidden="true"><span /></div>
        <span className="public-intro-loader__caption">Setting up your dining experience</span>
      </div>
    </div>
  );
}
