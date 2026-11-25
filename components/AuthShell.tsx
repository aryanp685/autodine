'use client';

import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
import { AuthHandoffLink } from '@/components/AuthHandoffLink';
import { useBrandHandoff } from '@/components/useBrandHandoff';
import { BrandMark } from '@/components/BrandMark';
import { AuthPanelArt } from '@/components/auth/AuthPanelArt';
import { AuthProductPreview } from '@/components/auth/AuthProductPreview';

export const authButtonClass =
  'inline-flex min-h-[46px] items-center justify-center gap-2 rounded-full bg-[var(--auth-accent)] px-5 py-3 text-[13.5px] font-semibold text-[var(--auth-heading)] shadow-[0_10px_26px_-14px_rgba(234,106,42,0.85)] transition-[background-color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:bg-[var(--auth-accent-strong)] hover:shadow-[0_16px_32px_-14px_rgba(234,106,42,0.8)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--auth-accent-ink)] disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0';

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

      <header className="relative z-10 border-b border-[#e8dcc9]/80 bg-[#fffdf8]/75 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] w-full max-w-[1360px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
          <AuthHandoffLink href="/" ref={brandRef} data-brand-handoff className="inline-flex items-center gap-3 text-gink transition-opacity hover:opacity-75">
            <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-forest shadow-[0_8px_20px_-12px_rgba(31,61,46,0.8)]">
              <BrandMark size={25} ink="#fffdf8" dot="#f08a55" tone="auth" />
            </span>
            <span>
              <span className="block text-[16px] leading-none font-semibold tracking-[-0.045em] text-gink">AutoDine</span>
              <span className="mt-1 hidden text-[10px] tracking-[0.04em] text-gink-46 sm:block">Restaurant ordering &amp; operations</span>
            </span>
          </AuthHandoffLink>

          {action ? (
            <div className="flex items-center gap-2.5 text-[12px] sm:gap-3 sm:text-[12.5px]">
              <span className="hidden text-gink-46 md:inline">{action.prompt}</span>
              <Link
                href={action.href}
                prefetch={false}
                className="inline-flex min-h-10 items-center rounded-full border border-[#e5d8c6] bg-white/80 px-4 font-semibold text-forest transition-[background-color,border-color,transform,box-shadow] duration-300 hover:-translate-y-px hover:border-forest/25 hover:bg-white hover:shadow-[0_8px_20px_-14px_rgba(31,61,46,0.55)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:px-5"
              >
                {action.label}
              </Link>
            </div>
          ) : null}
        </div>
      </header>

      <main
        data-auth-enhanced={visual ? '' : undefined}
        className={`relative z-10 mx-auto grid w-full max-w-[1240px] gap-8 px-5 pt-8 pb-14 sm:px-8 sm:pt-10 lg:items-start lg:gap-12 lg:px-10 lg:pt-10 lg:pb-20 ${
          visual ? 'lg:grid-cols-[480px_minmax(0,1fr)]' : 'max-w-[640px]'
        }`}
      >
        <div className="auth-rise mx-auto w-full max-w-[480px]">
          <section
            data-auth-card
            className="relative overflow-hidden rounded-[28px] border border-white/90 bg-[#fffdf8] px-5 py-7 shadow-[0_24px_70px_-38px_rgba(43,32,21,0.32)] backdrop-blur-xl sm:rounded-[32px] sm:px-8 sm:py-9"
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--auth-accent)] via-[var(--auth-accent)]/70 to-forest/70"
            />
            <p className="flex items-center gap-2.5 text-[10.5px] font-semibold tracking-[0.14em] text-[var(--auth-accent-ink)] uppercase">
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
            <div className="relative overflow-hidden rounded-[30px] bg-forest text-white shadow-[0_38px_90px_-48px_rgba(31,61,46,0.72)] sm:rounded-[34px]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    'linear-gradient(180deg, rgba(31,61,46,0.16) 0%, rgba(31,61,46,0.42) 38%, #1f3d2e 72%), url(/img/restaurant-interior-light.jpg)',
                  backgroundPosition: 'center, center 42%',
                  backgroundSize: 'cover, cover',
                }}
              />
              <AuthPanelArt />
              <div className="relative z-10 px-3 pb-7 sm:px-6 sm:pb-9">
                <AuthProductPreview />
                <div className="px-2 pt-7 sm:px-4 sm:pt-8">{visual}</div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
