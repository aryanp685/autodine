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
      { label: 'How it works', href: '/#flow' },
      { label: 'The screens', href: '/#tour' },
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
    <footer className="foot">
      <div className="p-wrap">
        <div className="foot__grid">
          <div>
            <div className="foot__brand">
              <BrandLockup size={20} ink="currentColor" dot={BRAND_GREEN} />
            </div>
            <p className="foot__note">{note}</p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="foot__colTitle">{col.title}</p>
              <ul className="foot__links">
                {col.items.map((item) => (
                  <li key={item.label}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <p className="foot__colTitle">Scope</p>
            <p className="foot__text">{scope}</p>
          </div>
        </div>

        <div className="foot__fine">
          <span>{fineLeft}</span>
          <span>{fineRight}</span>
        </div>

        <span className="foot__wordmark" aria-hidden="true">
          AutoDine
        </span>
      </div>
    </footer>
  );
}
