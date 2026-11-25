'use client';

import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
import { AuthHandoffLink } from '@/components/AuthHandoffLink';
import { useBrandHandoff } from '@/components/useBrandHandoff';
import { BrandMark } from '@/components/BrandMark';
import { AuthPanelArt } from '@/components/auth/AuthPanelArt';

export const authButtonClass =
  'inline-flex min-h-[46px] items-center justify-center gap-2 rounded-full bg-[var(--auth-accent)] px-5 py-3 text-[13.5px] font-medium text-white shadow-[0_10px_26px_-14px_rgba(180,83,27,0.8)] transition-[background-color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:bg-[var(--auth-accent-strong)] hover:shadow-[0_16px_32px_-14px_rgba(180,83,27,0.75)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--auth-accent)] disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0';

/**
 * The shell every signed-out account screen wears.
 *
 * Swagat Warmth: the owner's first touch is a warm cream page with the form
 * card on the left and, on wide screens, a deep forest panel on the right
 * carrying the botanical waiter illustration. The form is the only thing with
 * contrast; the panel is the welcome.
 *
 * The visual slot renders inside the forest panel, below the illustration. On
 * a phone the panel is removed rather than compressed, and the card takes the
 * full measure of the screen.
 */
export function AuthShell({
  visual,
  eyebrow,
  title,
  lede,
  children,
  action,
  notes,
  notesTitle = 'What this build actually does',
}: {
  visual?: ReactNode;
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
  children: ReactNode;
  /** The one link for the other side of this page: sign in <> sign up. */
  action?: { prompt: string; label: string; href: string };
  /** True statements about the build. Rendered quietly, under the card. */
  notes?: ReactNode[];
  notesTitle?: string;
}) {
  const brandRef = useRef<HTMLAnchorElement>(null);
  useBrandHandoff(brandRef);

  return (
    <div
      data-surface="owner"
      data-auth-shell
      className="relative min-h-dvh overflow-hidden bg-paper text-gink antialiased"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_12%_0%,rgba(180,83,27,0.07),transparent_60%),radial-gradient(50%_40%_at_92%_8%,rgba(31,61,46,0.07),transparent_62%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[#f3ecdf] to-transparent"
      />

      <header className="relative z-10 border-b border-hair/80 bg-white/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-5 sm:px-8">
          <AuthHandoffLink href="/" ref={brandRef} data-brand-handoff className="inline-flex items-center gap-2.5 text-gink transition-opacity hover:opacity-75">
            <BrandMark size={25} className="translate-y-[1px]" tone="auth" />
            <span className="text-[16px] leading-none font-medium tracking-[-0.04em]">autodine</span>
          </AuthHandoffLink>

          {action ? (
            <div className="flex items-center gap-3 text-[12.5px]">
              <span className="hidden text-gink-46 sm:inline">{action.prompt}</span>
              <Link
                href={action.href}
                prefetch={false}
                className="inline-flex h-9 items-center rounded-full border border-hair bg-white/70 px-4 font-medium text-gink transition-[background-color,border-color,transform] duration-300 hover:-translate-y-px hover:border-forest/25 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                {action.label}
              </Link>
            </div>
          ) : null}
        </div>
      </header>

      <main
        data-auth-enhanced={visual ? '' : undefined}
        className={`relative z-10 mx-auto grid w-full max-w-[1180px] gap-10 px-5 pt-10 pb-16 sm:px-8 sm:pt-14 lg:items-stretch lg:gap-12 lg:pt-14 ${
          visual ? 'lg:grid-cols-[452px_minmax(0,1fr)]' : 'max-w-[620px]'
        }`}
      >
        <div className="auth-rise mx-auto w-full max-w-[452px]">
          <section
            data-auth-card
            className="relative overflow-hidden rounded-[26px] border border-white/80 bg-white/90 px-5 py-7 shadow-[0_30px_70px_-44px_rgba(43,32,21,0.45)] backdrop-blur-xl sm:px-8 sm:py-9"
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--auth-accent)] via-[var(--auth-accent)]/70 to-forest/70"
            />
            <p className="flex items-center gap-2.5 text-[10.5px] font-semibold tracking-[0.14em] text-[var(--auth-accent)] uppercase">
              <span aria-hidden="true" className="h-px w-5 bg-[var(--auth-accent)]" />
              {eyebrow}
            </p>
            <h1 className="mt-3 text-balance text-[clamp(1.55rem,3.2vw,1.95rem)] leading-[1.12] font-medium tracking-[-0.045em] text-[var(--auth-heading)]">
              {title}
            </h1>
            <p className="mt-2.5 border-b border-hair pb-5 text-[13px] leading-[1.6] text-gink-64">
              {lede}
            </p>

            <div className="pt-6">{children}</div>
          </section>

          {notes && notes.length > 0 ? (
            <aside data-auth-notes className="mt-7 px-1">
              <p className="text-[10.5px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
                {notesTitle}
              </p>
              <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
                {notes.map((note, index) => (
                  <li
                    key={index}
                    className="flex gap-2.5 text-[11.5px] leading-[1.6] text-gink-46 [&_strong]:font-medium [&_strong]:text-gink-64"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[7px] size-1 shrink-0 rounded-full bg-gink-28"
                    />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}

          <nav aria-label="Account pages" className="mt-7 flex flex-wrap items-center justify-between gap-3 px-1 text-[11px] text-gink-46">
            <span className="inline-flex items-center gap-1.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="2.5" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              Secure account access
            </span>
            <span className="flex gap-4">
              <Link href="/privacy" prefetch={false} className="transition-colors hover:text-gink">Privacy</Link>
              <Link href="/terms" prefetch={false} className="transition-colors hover:text-gink">Terms</Link>
            </span>
          </nav>
        </div>

        {visual ? (
          <div className="auth-panel-fade auth-panel-fade-delay hidden lg:sticky lg:top-14 lg:block lg:self-start">
            <div className="relative overflow-hidden rounded-[32px] bg-forest text-white shadow-[0_44px_90px_-52px_rgba(31,61,46,0.75)]">
              <AuthPanelArt />
              <div className="relative z-10 flex min-h-[600px] flex-col justify-end px-8 pt-[440px] pb-8 sm:px-10">
                {visual}
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
