import Link from 'next/link';

/* ============================================================================
   The closing band: one line of intent, one sentence of reassurance, two
   actions. Every public screen ends with it before the footer, so the page
   always finishes somewhere rather than simply stopping.

   Server Component.
   ========================================================================== */

type Action = { label: string; href: string };

type Props = {
  eyebrow?: string;
  title: string;
  body: string;
  primary: Action;
  secondary?: Action;
};

export function SiteClosing({
  eyebrow = 'Start here',
  title,
  body,
  primary,
  secondary,
}: Props) {
  return (
    <section className="p-close">
      <div className="p-wrap p-close__inner">
        <div>
          <div className="p-eyebrow">{eyebrow}</div>
          <h2 className="p-h2 p-close__title" style={{ marginTop: 24 }}>
            {title}
          </h2>
          <p className="p-lede" style={{ marginTop: 22, maxWidth: '44ch' }}>
            {body}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href={primary.href} className="p-btn p-btn--solid">
            {primary.label}
          </Link>
          {secondary && (
            <Link href={secondary.href} className="p-btn p-btn--line">
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
