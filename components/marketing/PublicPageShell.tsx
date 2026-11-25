import Image from 'next/image';
import { HomeNav } from '@/components/HomeNav';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteMotion } from '@/components/SiteMotion';
import { PublicIntroLoader } from '@/components/marketing/PublicIntroLoader';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReactNode } from 'react';

export type MarketingRoute = 'product' | 'how' | 'screens' | 'trust';

export function PublicPageShell({
  activePage,
  eyebrow,
  title,
  description,
  exploreHref,
  exploreLabel,
  children,
}: {
  activePage: MarketingRoute;
  eyebrow: string;
  title: ReactNode;
  description: string;
  exploreHref: string;
  exploreLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="public-landing min-h-screen overflow-x-clip bg-ink text-cream antialiased">
      <PublicIntroLoader />
      <HomeNav activePage={activePage} />
      <main>
        <header className="relative isolate overflow-hidden border-b border-ink-line bg-white">
          <div className="pointer-events-none absolute inset-0 z-0">
            <Image
              src="/img/restaurant-interior-light.jpg"
              alt=""
              fill
              sizes="100vw"
              className="object-cover object-[68%_48%] opacity-55"
            />
          </div>
          <div aria-hidden="true" className="absolute inset-0 z-0 bg-[linear-gradient(100deg,rgba(250,246,240,0.97)_0%,rgba(250,246,240,0.87)_54%,rgba(250,246,240,0.55)_100%)]" />

          <div className="relative z-10 mx-auto grid max-w-[1240px] gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.7fr)] lg:items-center lg:gap-16 lg:px-10 lg:py-24">
            <div className="max-w-[680px]">
              <p className="inline-flex items-center gap-2.5 rounded-full border border-forest/15 bg-white/75 px-3.5 py-1.5 text-[10px] font-semibold tracking-[0.18em] text-forest uppercase backdrop-blur" data-reveal>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-brass" />
                {eyebrow}
              </p>
              <h1 className="display mt-6 text-[clamp(2.55rem,5.5vw,4.5rem)] leading-[0.98] tracking-[-0.04em] text-cream" data-reveal>
                {title}
              </h1>
              <p className="mt-5 max-w-[54ch] text-pretty text-[15px] leading-[1.8] text-mute sm:text-[16px]" data-reveal>
                {description}
              </p>
              <div className="mt-8 flex flex-wrap gap-3" data-reveal>
                <ButtonLink href="/signup" size="lg">Start your trial <span aria-hidden="true">→</span></ButtonLink>
                <ButtonLink href={exploreHref} variant="outline" size="lg">{exploreLabel}</ButtonLink>
              </div>
            </div>

            <Card className="relative overflow-hidden border-white/90 bg-ink-card/95 backdrop-blur-sm" data-reveal>
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brass via-brass/50 to-forest/70" />
              <CardHeader className="pb-4">
                <p className="text-[10px] font-semibold tracking-[0.16em] text-brass-strong uppercase">Built for service</p>
                <CardTitle className="mt-2 text-[20px] leading-tight">Menu → kitchen → counter</CardTitle>
                <CardDescription className="mt-1">One clear hand-off at a time.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2.5" aria-label="AutoDine service flow">
                  {[
                    ['01', 'Guest scans a table card', 'Menu opens on their phone'],
                    ['02', 'Order reaches the kitchen', 'Table and notes stay attached'],
                    ['03', 'Staff settle at the counter', 'Payment is checked, then recorded'],
                  ].map(([number, titleText, detail]) => (
                    <li key={number} className="flex items-center gap-3 rounded-[16px] border border-ink-line bg-white px-3.5 py-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-forest-soft text-[10px] font-semibold text-forest">{number}</span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold text-cream">{titleText}</span>
                        <span className="mt-0.5 block text-[10.5px] text-mute">{detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 border-t border-ink-line pt-3 text-[10.5px] leading-relaxed text-mute">
                  Preview only · No online guest payments · Sample workspace content
                </p>
              </CardContent>
            </Card>
          </div>
        </header>
        {children}
      </main>
      <SiteFooter />
      <SiteMotion />
    </div>
  );
}
