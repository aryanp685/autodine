'use client';

import { useRef } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { RouteSkeleton } from '@/components/RouteSkeleton';
import { AuthHandoffLink } from '@/components/AuthHandoffLink';
import { useBrandHandoff } from '@/components/useBrandHandoff';

/**
 * The loading boundary for the signed-out account screens.
 *
 * It keeps the AuthShell frame — same paper, same 64px bar, same column — so
 * the skeleton lands where the form will land. The lockup is the handoff
 * target for arrivals from the marketing pages: if this boundary renders
 * first, the wordmark animation runs here and the form that follows inherits
 * an already-settled lockup.
 */
export function AuthLoading() {
  const brandRef = useRef<HTMLAnchorElement>(null);
  useBrandHandoff(brandRef);

  return (
    <div data-surface="owner" className="relative min-h-dvh overflow-hidden bg-paper text-gink antialiased">
      <header className="relative z-10 border-b border-hair/80 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between gap-4 px-5 sm:px-8">
          <AuthHandoffLink
            ref={brandRef}
            data-brand-handoff
            href="/"
            aria-label="AutoDine home"
            className="inline-flex items-center gap-2.5 text-gink"
          >
            <BrandMark size={25} className="translate-y-[1px]" tone="auth" />
            <span className="text-[16px] leading-none font-medium tracking-[-0.04em]">autodine</span>
          </AuthHandoffLink>
          <div aria-hidden="true" className="h-9 w-[104px] rounded-full border border-hair bg-white/70" />
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1120px] px-5 pt-14 pb-16 sm:px-8">
        <RouteSkeleton variant="page" />
      </main>
    </div>
  );
}
