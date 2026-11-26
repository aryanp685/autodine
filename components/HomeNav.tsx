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
  { label: 'Product', href: '/#product', id: 'product' },
  { label: 'How it works', href: '/#how', id: 'how' },
  { label: 'Screens', href: '/#screens', id: 'screens' },
  { label: 'Pricing', href: '/pricing', id: 'pricing' },
] as const;

export function HomeNav({
  activePricing = false,
  glass = false,
}: {
  activePricing?: boolean;
  /** Landing hero mode: the photo runs behind the bar until the page scrolls. */
  glass?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);
  // The bar sits flush over the hero, then settles into a compact, slightly
  // more opaque pill once the page starts moving. Height only changes by one
  // row so the logo never shifts horizontally.
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(activePricing ? 'pricing' : null);
  const reduce = useReducedMotion();

  useEffect(() => {
    let frame = 0;
    const sections = NAV_LINKS.map((link) => document.getElementById(link.id)).filter(
      (node): node is HTMLElement => node !== null,
    );
    // Scrollspy must follow DOCUMENT order, not nav-label order: the product
    // section sits after screens in the DOM, so a nav-ordered loop kept
    // lighting "Screens" while the reader was on "Product".
    const ordered = [...sections].sort((a, b) => a.offsetTop - b.offsetTop);

    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 14);
      if (activePricing || ordered.length === 0) return;
      let current: string | null = null;
      for (const section of ordered) {
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
  }, [activePricing]);

  return (
    <header className="sticky top-0 z-50 px-3 pt-2.5 sm:px-5" data-scrolled={scrolled ? '' : undefined}>
      <div
        aria-hidden="true"
        className={[
          'pointer-events-none absolute inset-x-0 top-0 -z-10 h-20 bg-gradient-to-b from-ink via-ink/80 to-transparent transition-opacity duration-500',
          scrolled || open ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      />
      <div
        className={[
          'relative mx-auto flex max-w-[1180px] items-center gap-4 rounded-full border px-4 backdrop-blur-xl sm:px-5 lg:gap-6',
          'transition-[background-color,border-color,box-shadow,height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
          scrolled || open
            ? 'border-ink-line/90 bg-ink shadow-[0_20px_50px_-34px_rgba(42,33,23,0.6)]'
            : glass
              ? 'border-transparent bg-ink/55'
              : 'border-ink-line/60 bg-ink/90',
          scrolled ? 'h-14' : 'h-16',
        ].join(' ')}
      >
        <Link
          href="/"
          aria-label="AutoDine home"
          data-brand-handoff
          className="shrink-0 rounded-full text-cream transition-opacity duration-300 hover:opacity-75"
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
                    className="group relative inline-flex h-9 items-center whitespace-nowrap rounded-full px-3 text-[13px] font-semibold text-cream/70 transition-colors duration-300 hover:text-brass-strong aria-[current=page]:text-forest-strong lg:px-3.5"
                  >
                    {link.label}
                    <span
                      aria-hidden="true"
                      className={[
                        'absolute inset-x-3 bottom-0 h-[2px] origin-left rounded-full bg-brass transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] lg:inset-x-3.5',
                        current ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100 group-focus-visible:scale-x-100',
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
            className="hidden rounded-full px-3 text-[13px] font-semibold text-cream/70 transition-colors duration-300 hover:text-brass-strong md:inline-flex md:h-9 md:items-center"
          >
            Sign in
          </AuthHandoffLink>
          <AuthHandoffLink
            href="/signup"
            prefetch={false}
            className="group inline-flex h-10 items-center gap-2 rounded-full bg-brass pl-4 pr-3.5 text-[13px] font-bold text-cream shadow-[0_8px_16px_rgba(244,123,41,0.3)] transition-[background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-brass-strong hover:shadow-[0_12px_22px_rgba(232,91,19,0.35)] active:translate-y-0 active:bg-brass-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brass motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:pl-5 lg:pr-4"
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
            className="grid size-10 place-items-center rounded-full border border-hair-strong/60 text-cream transition-colors duration-300 hover:bg-cream/[0.06] md:hidden"
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
            className="mx-auto mt-2 max-w-[1180px] overflow-hidden rounded-[26px] border border-ink-line bg-ink/95 px-2 py-2 shadow-[0_30px_60px_-40px_rgba(28,27,24,0.55)] backdrop-blur-xl md:hidden"
            initial={reduce ? false : { height: 0, opacity: 0, y: -6 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={reduce ? undefined : { height: 0, opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <ul className="flex flex-col">
              {NAV_LINKS.map((link, index) => (
                <li key={link.id}>
                  <a
                    href={link.href}
                    aria-current={active === link.id ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className="flex items-baseline justify-between rounded-2xl px-4 py-3 text-[15px] text-cream/80 transition-colors duration-300 hover:bg-forest-soft/45 hover:text-cream"
                  >
                    {link.label}
                    <span aria-hidden="true" className="font-display text-[11px] italic text-mute-dim">
                      0{index + 1}
                    </span>
                  </a>
                </li>
              ))}
              <li className="mt-1 border-t border-ink-line/70 pt-1">
                <Link
                  href="/login"
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className="block rounded-2xl px-4 py-3 text-[15px] text-cream/80 transition-colors duration-300 hover:bg-forest-soft/45 hover:text-cream"
                >
                  Sign in
                </Link>
              </li>
            </ul>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
