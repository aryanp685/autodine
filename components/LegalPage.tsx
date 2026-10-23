import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLockup } from '@/components/BrandMark';
import { SiteFooter } from '@/components/SiteFooter';
import { BRAND_GREEN } from '@/lib/brand';

/**
 * The shape both reading pages share.
 *
 * Plain facts, in plain sentences, on the same dark surface as the rest of the
 * public site. These pages describe what the code actually does — which rows
 * are written, what a guest is never asked for, what happens to a workspace
 * whose trial ends. They are not a substitute for legal advice, and they say so
 * at the top rather than implying a lawyer read them.
 */
export function LegalPage({
  kicker,
  title,
  lede,
  children,
}: {
  kicker: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink text-cream antialiased">
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto flex h-16 max-w-[820px] items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="AutoDine home">
            <BrandLockup size={21} ink="#f7f3ea" dot={BRAND_GREEN} />
          </Link>
          <Link href="/" className="text-[13px] text-mute transition-colors hover:text-cream">
            Back to the site
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[820px] px-5 py-20 sm:px-8">
        <p className="text-[11px] font-semibold tracking-[0.24em] text-gold uppercase">{kicker}</p>
        <h1 className="mt-5 text-[clamp(2rem,4.4vw,3rem)] leading-[1.05] font-medium tracking-[-0.04em]">
          {title}
        </h1>
        <p className="mt-5 max-w-[62ch] text-[15px] leading-relaxed text-mute">{lede}</p>

        <p className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[12.5px] leading-relaxed text-mute-dim">
          Product preview. This page describes what the software does today, in plain language. It is
          not a lawyer&apos;s document, and it will be replaced by one before any restaurant is charged
          money.
        </p>

        <div className="mt-12 space-y-10">{children}</div>
      </main>

      <SiteFooter fineRight="Product preview" />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[17px] font-medium tracking-tight text-cream">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-[1.7] text-mute">{children}</div>
    </section>
  );
}
