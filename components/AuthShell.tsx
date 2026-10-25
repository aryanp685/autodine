import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/BrandMark';

/**
 * The shell every signed-out account screen wears.
 *
 * Sign in, sign up, forgotten password and the reset form are the only four
 * pages an owner sees before they trust this thing with their restaurant. They
 * used to be the least designed screens in the product: a marketing-era
 * two-column layout, four bordered cards in the aside, and copy written for a
 * preview build that no longer exists.
 *
 * So: one column, one card, one action. The status notes are still here — they
 * are the honest part — but they sit under the card as prose rather than in a
 * second column competing with the form.
 *
 * The one flourish is the rule under the title: it turns the card from a box
 * with fields in it into a page with a head, which is what makes a form feel
 * finished rather than assembled.
 */
export function AuthShell({
  eyebrow,
  title,
  lede,
  children,
  action,
  notes,
  notesTitle = 'What this build actually does',
}: {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  children: ReactNode;
  /** The one link for the other side of this page: sign in <> sign up. */
  action?: { prompt: string; label: string; href: string };
  /** True statements about the build. Rendered quietly, under the card. */
  notes?: ReactNode[];
  notesTitle?: string;
}) {
  return (
    <div data-surface="owner" data-auth-shell className="min-h-dvh bg-paper text-gink antialiased">
      <header className="border-b border-hair">
        <div className="mx-auto flex h-14 w-full max-w-[1080px] items-center justify-between gap-4 px-5 sm:px-7">
          <Link href="/" className="inline-flex items-baseline gap-2 text-gink">
            <BrandMark size={24} className="translate-y-[2px]" tone="auth" />
            <span className="text-[16px] leading-none font-medium tracking-[-0.04em]">autodine</span>
          </Link>

          {action ? (
            <div className="flex items-baseline gap-2 text-[12px]">
              <span className="hidden text-gink-46 sm:inline">{action.prompt}</span>
              <Link
                href={action.href}
                className="rounded-full bg-[color-mix(in_oklab,var(--p-ink)_7%,transparent)] px-3.5 py-2 font-medium text-gink transition-colors hover:bg-[color-mix(in_oklab,var(--p-ink)_11%,transparent)]"
              >
                {action.label}
              </Link>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1080px] px-5 pt-10 pb-16 sm:px-7 sm:pt-14">
        <div className="mx-auto w-full max-w-[440px]">
          <section className="rounded-[16px] border border-hair bg-card px-6 py-7 sm:px-8 sm:py-8">
            <p className="text-[10.5px] font-semibold tracking-[0.12em] text-gink-46 uppercase">
              {eyebrow}
            </p>
            <h1 className="mt-2.5 text-[clamp(1.5rem,3.4vw,1.9rem)] leading-[1.15] font-medium tracking-[-0.04em] text-gink">
              {title}
            </h1>
            <p className="mt-2 border-b border-hair pb-5 text-[13px] leading-[1.55] text-gink-64">
              {lede}
            </p>

            <div className="pt-5">{children}</div>
          </section>

          {notes && notes.length > 0 ? (
            <aside className="mt-6 px-1">
              <p className="text-[10.5px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
                {notesTitle}
              </p>
              <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
                {notes.map((note, index) => (
                  <li
                    key={index}
                    className="flex gap-2.5 text-[11.5px] leading-[1.55] text-gink-46 [&_strong]:font-medium [&_strong]:text-gink-64"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[7px] size-1 shrink-0 rounded-full bg-gink-28"
                    />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
