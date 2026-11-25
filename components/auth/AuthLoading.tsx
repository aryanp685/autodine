'use client';

import { useRef } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { AuthHandoffLink } from '@/components/AuthHandoffLink';
import { useBrandHandoff } from '@/components/useBrandHandoff';

/**
 * The loading boundary for the signed-out account screens.
 *
 * Reference "Loading Page": the brand lockup, the tagline, a cloche that
 * hovers gently and a spinner arc — never a spinner-only skeleton. The lockup
 * is the handoff target for arrivals from the marketing pages: if this
 * boundary renders first, the wordmark animation runs here and the form that
 * follows inherits an already-settled lockup.
 */
export function AuthLoading() {
  const brandRef = useRef<HTMLAnchorElement>(null);
  useBrandHandoff(brandRef);

  return (
    <div data-surface="owner" data-auth-shell className="relative min-h-dvh overflow-hidden bg-paper text-gink antialiased">
      <header className="relative z-10 border-b border-hair/80 bg-white/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-5 sm:px-8">
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

      <main className="relative z-10 grid min-h-[calc(100dvh-4rem)] place-items-center px-5 py-16">
        <div className="flex w-full max-w-[420px] flex-col items-center text-center" role="status" aria-live="polite">
          <span
            aria-hidden="true"
            className="auth-cloche-hover relative grid size-[132px] place-items-center rounded-full bg-[var(--auth-accent-soft)]"
          >
            <svg width="76" height="76" viewBox="0 0 76 76" fill="none" aria-hidden="true">
              <path
                d="M16 46a22 22 0 0 1 44 0"
                stroke="var(--auth-accent)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path d="M10 46h56" stroke="var(--auth-heading)" strokeWidth="3" strokeLinecap="round" />
              <circle cx="38" cy="19" r="3.4" fill="var(--auth-heading)" />
              <path d="M38 22.5V27" stroke="var(--auth-heading)" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M14 54h48" stroke="var(--auth-heading)" strokeWidth="2.6" strokeLinecap="round" opacity="0.5" />
            </svg>
          </span>

          <p className="mt-7 text-[18px] leading-none font-medium tracking-[-0.03em] text-[var(--auth-heading)]">
            autodine
          </p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gink-46">
            Scan · Order · Enjoy
          </p>

          <span
            aria-hidden="true"
            className="auth-arc mt-8 block size-7 rounded-full border-[2.5px] border-[var(--auth-accent)]/20 border-t-[var(--auth-accent)]"
          />
          <p className="mt-4 text-[12.5px] leading-[1.6] text-gink-64">Setting your table…</p>
        </div>
      </main>
    </div>
  );
}
