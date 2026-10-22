import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { SampleMenu } from '@/components/screens/SampleMenu';

export const metadata: Metadata = {
  title: 'Sample menu · AutoDine',
  description: 'A sample restaurant menu, set the way a guest reads one on their phone.',
};

/**
 * A public, read-only menu.
 *
 * The marketing pages have always pointed at /menu as "the demo", but /menu is
 * the screen a guest reaches by scanning a card, and it refuses anyone without
 * a live table session. So the one screen the product is actually about was
 * invisible to anybody evaluating it: every "Open the menu" button ended on a
 * gate.
 *
 * This route shows the same design system on the same kind of content with no
 * session, no database read and, importantly, no controls: a sample menu that
 * offered an "Add" button would promise an order it cannot take. Ordering
 * stays where it belongs, behind the QR code on a table.
 */
export default function SampleMenuPage() {
  return (
    <>
      <SiteNav
        links={[
          { label: 'Product', href: '/#product' },
          { label: 'How it works', href: '/#flow' },
          { label: 'Pricing', href: '/pricing' },
        ]}
      />

      <main>
        <SampleMenu />

        <section className="p-close">
          <div className="p-wrap p-close__inner">
            <div>
              <div className="p-eyebrow">Where this goes</div>
              <h2 className="p-h2 p-close__title" style={{ marginTop: 24 }}>
                A real menu takes orders.
              </h2>
              <p className="p-lede" style={{ marginTop: 22, maxWidth: '44ch' }}>
                This sample is a photograph of the design. Behind a table card, the same dishes
                add to an order, reach the kitchen board and settle at the counter.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/signup" className="p-btn p-btn--solid">
                Create an account
              </Link>
              <Link href="/pricing" className="p-btn p-btn--line">
                See pricing
              </Link>
            </div>
          </div>
        </section>

        <SiteFooter />
      </main>
    </>
  );
}
