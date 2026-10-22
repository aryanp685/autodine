import Link from 'next/link';
import type { ReactNode } from 'react';

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
 * Everything is `[data-app]`-scoped CSS in styles/app.css, like the rest of the
 * product, so this is not a fifth visual language.
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
    <div className="auth">
      <header className="authBar">
        <Link href="/" className="authBar__brand">
          AutoDine
        </Link>

        {action ? (
          <div className="authBar__right">
            <span className="authBar__prompt">{action.prompt}</span>
            <Link href={action.href} className="authBar__link">
              {action.label}
            </Link>
          </div>
        ) : null}
      </header>

      <main className="authBody">
        <section className="authCard">
          <p className="authCard__eyebrow">{eyebrow}</p>
          <h1 className="authCard__title">{title}</h1>
          <p className="authCard__lede">{lede}</p>
          {children}
        </section>

        {notes && notes.length > 0 ? (
          <aside className="authNotes">
            <p className="authNotes__head">{notesTitle}</p>
            <ul className="authNotes__list">
              {notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </aside>
        ) : null}
      </main>
    </div>
  );
}
