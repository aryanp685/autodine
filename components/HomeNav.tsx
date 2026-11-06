'use client';

/**
 * The landing bar's phone menu. The desktop bar is server-rendered as before;
 * only the disclosure needs state, so only this file is a client component.
 */

import Link from 'next/link';
import { useState } from 'react';
import { BrandLockup } from '@/components/BrandMark';
import { BRAND_GREEN } from '@/lib/brand';

export function HomeNav() {

  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 border-b border-cream/[0.12] bg-ink/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-8 px-5 sm:px-8">
        <Link href="/" aria-label="AutoDine home" className="shrink-0 text-cream">
          <BrandLockup size={21} ink="currentColor" dot={BRAND_GREEN} />
        </Link>

        <nav aria-label="Primary" className="hidden flex-1 md:block">
          <ul className="flex items-center gap-7 text-[13px] text-mute">
            <li><Link href="#product" className="transition-colors hover:text-cream">Product</Link></li>
            <li><Link href="#how" className="transition-colors hover:text-cream">How it works</Link></li>
            <li><Link href="#screens" className="transition-colors hover:text-cream">Screens</Link></li>
            <li><Link href="/pricing" className="transition-colors hover:text-cream">Pricing</Link></li>
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link href="/login" className="hidden text-[13px] text-mute transition-colors hover:text-cream sm:block">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-10 items-center rounded-full bg-forest px-5 text-[13px] font-medium text-white transition-colors hover:bg-forest-strong"
          >
            Create account
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="home-nav-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
            className="grid size-11 place-items-center rounded-full border border-cream/15 text-cream transition-colors hover:bg-cream/[0.06] md:hidden"
          >
            <span aria-hidden="true" className="text-[15px] leading-none">
              {open ? '✕' : '☰'}
            </span>
          </button>
        </div>
      </div>

      {open ? (
        <nav id="home-nav-menu" aria-label="Primary (mobile)" className="border-t border-cream/[0.12] bg-ink px-5 pb-4 pt-2 md:hidden">
          <ul className="flex flex-col gap-1">
            {[
              ['Product', '#product'],
              ['How it works', '#how'],
              ['Screens', '#screens'],
              ['Pricing', '/pricing'],
            ].map(([label, href]) => (
              <li key={href}>
                <a
                  href={href}
                  onClick={() => setOpen(false)}
                  className="block rounded-[10px] px-3 py-2.5 text-[14px] text-cream/75 transition-colors hover:bg-cream/[0.05]"
                >
                  {label}
                </a>
              </li>
            ))}
            <li>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="block rounded-[10px] px-3 py-2.5 text-[14px] text-cream/75 transition-colors hover:bg-cream/[0.05] sm:hidden"
              >
                Sign in
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
