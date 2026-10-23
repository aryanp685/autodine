'use client';

/**
 * The site bar, and the one bit of state it needs.
 *
 * WHY A CLIENT COMPONENT FOR A HEADER
 *
 * Only for the scroll state. Everything it renders is static markup; the sole
 * reason this file ships JavaScript is to add `.is-scrolled` when the page
 * moves, which turns the transparent overlay into a translucent surface.
 *
 * WHY NOT A SCROLL LISTENER ON EVERY PIXEL
 *
 * scrollY is read at most once per animation frame and the class is written
 * only when the boolean actually changes, so a long scroll costs one write per
 * threshold crossing. The listener is passive: it never calls preventDefault
 * and cannot delay the scroll itself.
 *
 * If JavaScript never runs, the bar keeps its resting look. Nothing is hidden
 * and nothing is unreachable -- the scrolled state is an enhancement.
 */

import Link from 'next/link';
import { BrandLockup } from '@/components/BrandMark';
import { BRAND_GREEN } from '@/lib/brand';
import { useEffect } from 'react';

export type SiteNavLink = { label: string; href: string; active?: boolean };

/** A few pixels, not zero: the hero's top edge should not flicker the bar. */
const SCROLLED_AFTER_PX = 12;

export function SiteNav({
  links,
  onImage = false,
}: {
  links: SiteNavLink[];
  /**
   * True on a page whose top is a dark photograph or a dark ground: the bar
   * starts transparent with light type, then takes a surface underneath.
   *
   * On a paper page the same bar is dark type on paper, because light type on
   * near-white is not a style, it is a blank space where the navigation should
   * be.
   */
  onImage?: boolean;
}) {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('[data-site-nav]');
    if (!nav) return;

    let frame = 0;
    let scrolled = false;

    const apply = () => {
      frame = 0;
      const next = window.scrollY > SCROLLED_AFTER_PX;
      if (next === scrolled) return;
      scrolled = next;
      /* A data attribute, not a class: the surface is written in utilities, and
         a utility that depends on a class this component invents is exactly
         the coupling the migration is removing. */
      nav.dataset.scrolled = next ? 'true' : 'false';
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    // A refresh halfway down the page restores a scroll position; read once so
    // the bar matches the page before the first scroll event arrives.
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      delete nav.dataset.scrolled;
    };
  }, []);

  const surface = onImage
    ? 'data-[scrolled=true]:border-white/[0.07] data-[scrolled=true]:bg-ink/80 data-[scrolled=true]:backdrop-blur-xl'
    : 'border-b border-ink/10 bg-cream/85 backdrop-blur-xl';

  return (
    <header
      data-site-nav=""
      className={[
        'sticky top-0 z-50 border-b border-transparent transition-colors duration-300',
        surface,
      ].join(' ')}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center gap-8 px-5 sm:px-8">
        <Link
          href="/"
          aria-label="AutoDine home"
          className={onImage ? 'shrink-0 text-cream' : 'shrink-0 text-ink'}
        >
          <BrandLockup size={21} ink="currentColor" dot={BRAND_GREEN} />
        </Link>

        <nav aria-label="Primary" className="hidden flex-1 md:block">
          <ul
            className={[
              'flex items-center gap-7 text-[13px]',
              onImage ? 'text-mute' : 'text-ink/60',
            ].join(' ')}
          >
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={link.active ? 'page' : undefined}
                  className={[
                    'transition-colors',
                    onImage ? 'hover:text-cream' : 'hover:text-ink',
                    link.active ? (onImage ? 'text-cream' : 'text-ink') : '',
                  ].join(' ')}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/login"
            className={[
              'hidden text-[13px] transition-colors sm:block',
              onImage ? 'text-mute hover:text-cream' : 'text-ink/60 hover:text-ink',
            ].join(' ')}
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-10 items-center rounded-full bg-gold px-5 text-[13px] font-medium text-ink transition-colors hover:bg-gold-bright"
          >
            Create account
          </Link>
        </div>
      </div>
    </header>
  );
}
