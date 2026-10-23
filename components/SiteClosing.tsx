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
    <section className="border-t border-white/[0.07] bg-ink text-cream">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-10 px-5 py-20 sm:px-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10.5px] font-semibold tracking-[0.14em] text-gold-dim uppercase">{eyebrow}</p>
          <h2 className="mt-5 max-w-[14ch] text-[clamp(30px,4.6vw,50px)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
            {title}
          </h2>
          <p className="mt-5 max-w-[46ch] text-[15px] leading-[1.6] text-mute">{body}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={primary.href}
            className="inline-flex h-12 items-center rounded-full bg-gold px-6 text-[14px] font-medium text-ink transition-colors hover:bg-gold-bright"
          >
            {primary.label}
          </Link>
          {secondary && (
            <Link
              href={secondary.href}
              className="inline-flex h-12 items-center rounded-full border border-white/20 px-6 text-[14px] font-medium text-cream transition-colors hover:border-white/40 hover:bg-white/[0.06]"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
