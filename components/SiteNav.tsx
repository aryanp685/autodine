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
   * True on the home page, where the bar sits on top of a dark photograph
   * before any scroll. It inverts the links and the secondary button, then
   * lets them return to ink once the glass surface appears underneath.
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
      nav.classList.toggle('is-scrolled', next);
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
      nav.classList.remove('is-scrolled');
    };
  }, []);

  return (
    <header
      className={`siteNav${onImage ? ' siteNav--onImage' : ''}`}
      data-site-nav
    >
      <Link href="/" className="siteNav__brand" aria-label="AutoDine home">
        <BrandLockup size={22} ink="currentColor" dot={BRAND_GREEN} />
      </Link>

      <nav aria-label="Primary">
        <ul className="siteNav__links">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="siteNav__link"
                aria-current={link.active ? 'page' : undefined}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="siteNav__right">
        <Link href="/login" className="siteNav__link">
          Sign in
        </Link>
        <Link href="/signup" className="p-btn p-btn--solid p-btn--sm">
          Create account
        </Link>
      </div>
    </header>
  );
}
