import Link from 'next/link';
import { BrandLockup } from '@/components/BrandMark';
import { BRAND_GREEN } from '@/lib/brand';

/* ============================================================================
   The footer is the last thing a page says, so it says the same thing on every
   public screen. Screens that need a different line of small print pass one;
   nothing else about the shape changes, which is what keeps the language
   consistent as more screens are moved onto the premium styles.

   Server Component: no state, no client bundle.
   ========================================================================== */

const COLUMNS = [
  {
    title: 'Product',
    items: [
      { label: 'Overview', href: '/' },
      { label: 'How it works', href: '/#how' },
      { label: 'The screens', href: '/#screens' },
      { label: 'What is live', href: '/#status' },
    ],
  },
  {
    title: 'Plans',
    items: [
      { label: 'Pricing', href: '/pricing' },
      { label: 'Sign in', href: '/login' },
      { label: 'Create account', href: '/signup' },
    ],
  },
  {
    /*
      Anchors above were wrong for a while -- /#flow and /#tour do not exist on
      the page, so three of the footer's links scrolled nowhere. They now match
      the section ids in HomeScreen, and a link to a page that does not exist is
      worse than no link at all, so the two below point at real routes.
    */
    title: 'Reading',
    items: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
];

type Props = {
  note?: string;
  scope?: string;
  fineLeft?: string;
  fineRight?: string;
};

export function SiteFooter({
  note = 'Table QR ordering and restaurant operations, built around the service a restaurant actually runs.',
  scope = 'Sample restaurant content. No live payments or subscriptions.',
  fineLeft = 'AutoDine · Product preview',
  fineRight = 'Not for live restaurant operations',
}: Props = {}) {
  return (
    <footer className="bg-ink text-cream">
      <div className="mx-auto w-full max-w-[1180px] px-5 pt-16 pb-10 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr_1.2fr]">
          <div>
            <div className="text-cream">
              <BrandLockup size={20} ink="currentColor" dot={BRAND_GREEN} />
            </div>
            <p className="mt-4 max-w-[38ch] text-[13px] leading-[1.6] text-mute">{note}</p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute-dim uppercase">
                {col.title}
              </p>
              <ul className="mt-3 flex flex-col gap-2 text-[13px] text-mute">
                {col.items.map((item) => (
                  <li key={item.label}>
                    <Link href={item.href} className="transition-colors hover:text-cream">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute-dim uppercase">Scope</p>
            <p className="mt-3 max-w-[30ch] text-[13px] leading-[1.6] text-mute">{scope}</p>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-5 text-[11px] tracking-[0.02em] text-mute-dim">
          <span>{fineLeft}</span>
          <span>{fineRight}</span>
        </div>

        {/* The wordmark, drawn at the scale of a sign rather than set as a
            heading: it is the last mark on the page, not another title. */}
        <div
          aria-hidden="true"
          className="mt-8 text-[clamp(46px,11vw,132px)] leading-[0.8] font-semibold tracking-[-0.045em] text-white/[0.055] select-none"
        >
          AutoDine
        </div>
      </div>
    </footer>
  );
}
