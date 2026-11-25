'use client';

/**
 * The landing bar's phone menu and scroll state. The desktop bar is
 * server-rendered as before; only the disclosure, the scroll-tightening
 * treatment and the section highlight need state, so only this file is a
 * client component.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BrandLockup } from '@/components/BrandMark';
import { AuthHandoffLink } from '@/components/AuthHandoffLink';
import { BRAND_GREEN } from '@/lib/brand';

const NAV_LINKS = [
  { label: 'Product', href: '/features', id: 'product' },
  { label: 'How it works', href: '/how-it-works', id: 'how' },
  { label: 'Screens', href: '/screens', id: 'screens' },
  { label: 'Trust', href: '/trust', id: 'trust' },
  { label: 'Pricing', href: '/pricing', id: 'pricing' },
] as const;

export function HomeNav({
  activePricing = false,
  activePage,
}: {
  activePricing?: boolean;
  activePage?: 'product' | 'how' | 'screens' | 'trust';
} = {}) {
  const [open, setOpen] = useState(false);
  // The bar sits flush over the hero, then settles into a compact, slightly
  // more opaque pill once the page starts moving. Height only changes by one
  // row so the logo never shifts horizontally.
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(activePricing ? 'pricing' : (activePage ?? null));
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    let frame = 0;
    const sections = NAV_LINKS.map((link) => document.getElementById(link.id)).filter(
      (node): node is HTMLElement => node !== null,
    );

    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 14);
      if (activePricing || activePage || sections.length === 0) return;
      let current: string | null = null;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= 160) current = section.id;
      }
      setActive(current);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [activePage, activePricing]);

  return (
    <header className="sticky top-0 z-50 mx-auto max-w-[1440px] px-3 pt-3 sm:px-6 lg:px-8" data-scrolled={scrolled ? '' : undefined}>
      <div
        aria-hidden="true"
        className={[
          'pointer-events-none absolute inset-x-0 top-0 -z-10 h-24 bg-gradient-to-b from-ink/95 via-ink/75 to-transparent transition-opacity duration-500',
          scrolled || open ? 'opacity-100' : 'opacity-60',
        ].join(' ')}
      />
      <div
        className={[
          'relative mx-auto flex max-w-[1280px] items-center gap-3 rounded-[22px] border px-3.5 backdrop-blur-2xl sm:gap-4 sm:px-5 lg:gap-6',
          'transition-[background-color,border-color,box-shadow,height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
          scrolled || open
            ? 'border-ink-line/90 bg-white/95 shadow-[0_14px_40px_-24px_rgba(24,61,50,0.24)]'
            : 'border-white/90 bg-white/90 shadow-[0_12px_34px_-24px_rgba(24,61,50,0.18)]',
          scrolled ? 'h-[58px]' : 'h-[64px]',
        ].join(' ')}
      >
        <Link
          href="/"
          aria-label="AutoDine home"
          data-brand-handoff
          className="shrink-0 rounded-full text-cream transition-[opacity,transform] duration-300 hover:scale-[1.02] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest motion-reduce:transform-none"
        >
          <BrandLockup size={21} ink="currentColor" dot={BRAND_GREEN} />
        </Link>

        <nav aria-label="Primary" className="hidden flex-1 md:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const current = active === link.id;
              return (
                <li key={link.id}>
                  <Link
                    href={link.href}
                    prefetch={false}
                    aria-current={current ? 'page' : undefined}
                    className={[
                      'group relative inline-flex h-10 items-center whitespace-nowrap rounded-xl px-3.5 text-[12.5px] font-medium transition-[background-color,color,box-shadow,transform] duration-300 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest motion-reduce:transform-none lg:px-3.5',
                      current ? 'bg-forest-soft text-forest shadow-[inset_0_0_0_1px_rgba(24,61,50,0.08)]' : 'text-mute hover:bg-ink-soft hover:text-cream',
                    ].join(' ')}
                  >
                    {link.label}
                    <span
                      aria-hidden="true"
                      className={[
                        'absolute right-2 top-1/2 size-1.5 -translate-y-1/2 scale-75 rounded-full bg-brass transition-[opacity,scale] duration-200',
                        current ? 'scale-100 opacity-100' : 'opacity-0',
                      ].join(' ')}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:gap-2.5">
          <AuthHandoffLink
            href="/login"
            prefetch={false}
            className="hidden h-10 items-center rounded-xl px-4 text-[12.5px] font-medium text-mute transition-[background-color,color] duration-200 hover:bg-ink-soft hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest md:inline-flex"
          >
            Sign in
          </AuthHandoffLink>
          <AuthHandoffLink
            href="/signup"
            prefetch={false}
            className="group inline-flex h-10 items-center gap-2 rounded-xl bg-brass px-4 text-[12.5px] font-semibold text-white shadow-[0_10px_24px_-14px_rgba(191,84,28,0.6)] transition-[background-color,transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:bg-brass-strong hover:shadow-[0_14px_28px_-14px_rgba(191,84,28,0.65)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass-strong motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:px-5"
          >
            Create account
            <span
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
            >
              →
            </span>
          </AuthHandoffLink>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="home-nav-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
            className="grid size-10 place-items-center rounded-xl border border-ink-line bg-white/70 text-cream transition-[background-color,border-color,box-shadow] duration-200 hover:border-forest/25 hover:bg-forest-soft hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest md:hidden"
          >
            <span aria-hidden="true" className="relative block h-[11px] w-4">
              <span
                className={[
                  'absolute left-0 top-0 h-px w-full bg-current transition-transform duration-300',
                  open ? 'translate-y-[5px] rotate-45' : '',
                ].join(' ')}
              />
              <span
                className={[
                  'absolute left-0 top-[5px] h-px w-full bg-current transition-opacity duration-200',
                  open ? 'opacity-0' : 'opacity-100',
                ].join(' ')}
              />
              <span
                className={[
                  'absolute left-0 top-[10px] h-px w-full bg-current transition-transform duration-300',
                  open ? '-translate-y-[5px] -rotate-45' : '',
                ].join(' ')}
              />
            </span>
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.nav
            id="home-nav-menu"
            aria-label="Primary (mobile)"
            className="mx-auto mt-2 max-w-[1280px] overflow-hidden rounded-[24px] border border-ink-line/90 bg-white/95 px-2.5 py-2.5 shadow-[0_24px_60px_-34px_rgba(24,61,50,0.28)] backdrop-blur-2xl md:hidden"
            initial={reduce ? false : { height: 0, opacity: 0, y: -6 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={reduce ? undefined : { height: 0, opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <ul className="flex flex-col">
              {NAV_LINKS.map((link, index) => (
                <li key={link.id}>
                  <Link
                    href={link.href}
                    prefetch={false}
                    aria-current={active === link.id ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className="flex min-h-12 items-center justify-between rounded-2xl px-4 py-3 text-[14px] font-medium text-cream/80 transition-[background-color,color,transform] duration-200 hover:translate-x-0.5 hover:bg-forest-soft/60 hover:text-forest focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-forest motion-reduce:transform-none"
                  >
                    {link.label}
                    <span aria-hidden="true" className="font-display text-[11px] italic text-mute-dim">
                      0{index + 1}
                    </span>
                  </Link>
                </li>
              ))}
              <li className="mt-2 grid grid-cols-2 gap-2 border-t border-ink-line/80 pt-3">
                <Link
                  href="/login"
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-ink-line bg-white px-3 text-[13px] font-semibold text-forest transition-colors hover:bg-forest-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brass px-3 text-[13px] font-semibold text-white shadow-[0_10px_24px_-16px_rgba(191,84,28,0.7)] transition-[background-color,transform] hover:-translate-y-px hover:bg-brass-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-strong motion-reduce:transform-none"
                >
                  Create account <span aria-hidden="true">→</span>
                </Link>
              </li>
            </ul>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
