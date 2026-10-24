import type { OutletBar } from '@/lib/outlets';
import { tables as demoTables, restaurant as demoRestaurant } from '@/lib/demo-data';
import { TableQr } from '@/components/TableQr';
import { PrintButton } from '@/components/PrintButton';
import type { TablesScreenData, TableRow } from '@/lib/db/tables-screen';
import {
  addTableAction,
  revokeQrAction,
  rotateQrAction,
  rotateVerificationCodeAction,
  setTableActiveAction,
} from '@/app/dashboard/tables/actions';
import { SignInPrompt } from '@/components/SignInPrompt';
import { VerificationCodeRefresh } from '@/components/VerificationCodeRefresh';
import {
  OwnerPage,
  PageHead,
  SectionHead,
  Card,
  btn,
  selectClass,
  Tag,
  Dot,
  type PillTone,
} from '@/components/owner/chrome';

/** The QR state as a word and a tone. Colour is never the only signal. */
const STATE: Record<string, { tone: PillTone; word: string }> = {
  active: { tone: 'live', word: 'Live' },
  printed: { tone: 'neutral', word: 'Printed' },
  revoked: { tone: 'failed', word: 'Revoked' },
  disabled: { tone: 'neutral', word: 'Disabled' },
};
/**
 * Shared page structure.
 *
 * `data` is the live floor plan when the database is configured. When it is
 * absent the screen falls back to its demo rows: twelve fictional tables with
 * twelve real QR codes, and no controls that pretend to manage them.
 */
export function TablesScreen({
  data,
  outlet,
  error,
  notice,
}: {
  data?: TablesScreenData | null;
  /** Which outlet is open, for the switcher in the bar. */
  outlet?: OutletBar | null;
  error?: string;
  notice?: string;
}) {
  const restaurantName = data?.restaurantName ?? demoRestaurant.name;
  // Blocked callers get an empty list, not the demo floor plan: twelve
  // fictional tables read as a real restaurant that happens to be quiet.
  const tables: TableRow[] = data?.tables ?? (data?.blocked ? [] : demoTables);
  const live = Boolean(data);

  // How often the on-site code rolls, in words, read from the row rather than
  // written into the copy: if a restaurant widens its window the sentence has
  // to change with it, or staff will tell guests the wrong thing.
  const codeMinutes = data?.verification
    ? Math.max(1, Math.round(data.verification.windowSeconds / 60))
    : 10;
  const minutes = `${codeMinutes} ${codeMinutes === 1 ? 'minute' : 'minutes'}`;

  return (
    <OwnerPage active="tables" outlet={outlet}>
      {/* Everything except the sheet is screen-only. The sheet is print-only.
          Tailwind's `print:` variant is the whole of that rule, so it holds
          without a stylesheet knowing any of these class names. */}
      <div className="print:hidden">
      <PageHead
        kicker="Tables & QR"
        title={`${tables.length} tables · ${restaurantName}`}
        meta={
          live
            ? 'Each card is bound to one table. Regenerating a code stops the old card at once.'
            : 'Sample floor plan — nothing here can be managed until a database is connected.'
        }
        actions={
          <>
            <PrintButton className={btn('ghost', 'sm')}>Print QR sheet</PrintButton>
            <form action={addTableAction} className="flex items-center gap-1.5">
              <select
                className={`${selectClass} h-8 w-[104px] text-[12px]`}
                name="seats"
                defaultValue="4"
                aria-label="Seats"
                disabled={!live}
              >
                {[2, 4, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} seats
                  </option>
                ))}
              </select>
              {/* Without a database this submit can only fail, so it does not
                  render as live. */}
              <button type="submit" className={btn('solid', 'sm')} disabled={!live}>
                Add table
              </button>
            </form>
          </>
        }
      />

      {data?.blocked && <SignInPrompt reason={data.blocked} screen="tables and QR screen" />}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-[12px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-4 py-3"
        >
          <strong className="text-[12.5px] text-[var(--alert)]">Could not update tables.</strong>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-64">{error}</p>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mb-4 rounded-[12px] border border-[var(--p-accent)]/25 bg-accent-soft px-4 py-2.5"
        >
          <strong className="text-[12.5px] text-gink">Done.</strong>{' '}
          <span className="text-[12.5px] text-gink-64">{notice}</span>
        </div>
      )}

      {/* ----------------------------------------------------- the on-site code
          The one thing on this screen that is shown to guests, so it is the one
          thing set in display type. Everything around it is instructions. */}
      {data?.verification ? (
        <section className="mb-4 overflow-hidden rounded-[14px] border border-hair bg-card">
          <div className="grid gap-5 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Dot tone="live" />
                <span className="text-[10.5px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
                  On-site code
                </span>
              </div>
              <p className="mt-2 max-w-[52ch] text-[12.5px] leading-[1.55] text-gink-64">
                Guests type these six digits after scanning a table&apos;s QR. Put this screen — or a
                printout of it — where guests can see it, and it changes every {minutes} on its own.
                Nothing to remember, nothing to reset.
              </p>
              <form className="mt-3">
                <button type="submit" formAction={rotateVerificationCodeAction} className={btn('ghost', 'sm')}>
                  New code now
                </button>
              </form>
              <VerificationCodeRefresh expiresAt={data.verification.expiresAt} />
            </div>

            <div
              aria-live="polite"
              className="rounded-[12px] border border-hair-strong bg-paper-deep px-5 py-4 text-center"
            >
              <div className="text-[clamp(1.9rem,3.4vw,2.5rem)] leading-none font-medium tracking-[0.16em] text-gink tabular-nums">
                {data.verification.code}
              </div>
              <div className="mt-2 text-[10.5px] tracking-[0.06em] text-gink-46 uppercase">
                changes every {minutes}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {data?.verificationError ? (
        <div
          role="alert"
          className="mb-4 rounded-[12px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-4 py-3"
        >
          <strong className="text-[12.5px] text-[var(--alert)]">
            The on-site code is not available.
          </strong>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-64">{data.verificationError}</p>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ floor plan */}
      <section aria-labelledby="floor-plan">
        <SectionHead
          title={<span id="floor-plan">The floor</span>}
          meta={live ? `${tables.length} tables` : 'sample'}
        />
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {tables.map((t) => {
            const state = STATE[t.qr] ?? { tone: 'neutral' as PillTone, word: t.qr };
            return (
              <li key={t.code}>
                <Card className="flex h-full flex-col px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[15px] font-semibold tracking-[-0.01em] text-gink">
                          {t.code}
                        </span>
                        <Tag tone={state.tone}>{state.word}</Tag>
                      </div>
                      {/* `label` is already "4 seater": printing the seat
                          count after it read "4 seater · 4 seats". */}
                      <div className="mt-1 text-[11.5px] text-gink-46">{t.label}</div>
                    </div>
                    {/* The code is the card's whole point, so it is drawn at a
                        size a phone can still read across a table. */}
                    <div className="shrink-0 rounded-[8px] border border-hair bg-white p-1">
                      <TableQr svg={t.qrSvg} fallbackValue={`${restaurantName}-${t.code}`} size={64} />
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-hair pt-2.5">
                    <div>
                      <dt className="text-[10px] font-medium tracking-[0.05em] text-gink-46 uppercase">
                        Last scan
                      </dt>
                      <dd className="mt-0.5 text-[12px] text-gink">{t.lastScan}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium tracking-[0.05em] text-gink-46 uppercase">
                        Orders today
                      </dt>
                      <dd className="mt-0.5 text-[12px] text-gink tabular-nums">{t.orders}</dd>
                    </div>
                  </dl>

                  {live && t.id ? (
                    /* One form per card. Every button shares the hidden table
                       id and overrides only the action, so all four are real
                       submissions rather than inert spans. */
                    <form className="mt-auto flex flex-wrap items-center gap-1 pt-3">
                      <input type="hidden" name="tableId" value={t.id} />
                      {/* Preview opens the card's own URL, which is what a
                          guest actually sees: the verification form, not a
                          menu. */}
                      <a
                        href={t.scanUrl ?? '/menu'}
                        target="_blank"
                        rel="noreferrer"
                        data-table-action="preview"
                        className={btn('quiet', 'sm')}
                      >
                        Preview
                      </a>
                      <button
                        type="submit"
                        formAction={rotateQrAction}
                        data-table-action="rotate"
                        className={btn('quiet', 'sm')}
                      >
                        Regenerate
                      </button>
                      <button
                        type="submit"
                        formAction={setTableActiveAction}
                        name="active"
                        value={t.qr === 'disabled' ? 'true' : 'false'}
                        data-table-action="toggle"
                        className={btn('quiet', 'sm')}
                      >
                        {t.qr === 'disabled' ? 'Enable' : 'Disable'}
                      </button>
                      <button
                        type="submit"
                        formAction={revokeQrAction}
                        data-table-action="revoke"
                        className={`${btn('danger', 'sm')} ml-auto`}
                      >
                        Revoke
                      </button>
                    </form>
                  ) : (
                    /* No database, no controls: four dead buttons under every
                       card taught that the codes were manageable. */
                    <p className="mt-auto pt-3 text-[11px] leading-[1.45] text-gink-46">
                      Sample card — connect the database to manage codes.
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      {/* -------------------------------------------------------------- notes
          Two statements, kept: how a scan works, and what it cannot do. The
          second is the one a restaurant will only discover the hard way. */}
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <div className="rounded-[12px] border border-hair bg-card px-4 py-3.5">
          <strong className="text-[12px] font-semibold text-gink">How a scan works</strong>
          <p className="mt-1 text-[11.5px] leading-[1.55] text-gink-64">
            The card on the table carries an unguessable token, not a link to the restaurant. Scanning
            it opens a short form that asks for the six-digit code above, and only then is a session
            created — bound to that one table, and expiring in under an hour, so an order placed from
            it is stamped with the table it was placed at. Each restaurant gets its own cards and its
            own code: one restaurant&apos;s card will not scan into another.
          </p>
        </div>
        <div className="rounded-[12px] border border-[var(--alert)]/25 bg-[var(--alert)]/6 px-4 py-3.5">
          <strong className="text-[12px] font-semibold text-gink">Honest limitation</strong>
          <p className="mt-1 text-[11.5px] leading-[1.55] text-gink-64">
            Somebody in the room can read the code out to somebody outside on the phone. A shared code
            is a deterrent, not proof of presence — no design that a seated guest has to be able to use
            can be proof. What it does buy is that the leak has to be live and human, that it dies
            within {minutes}, and that the session it produced can be ended by revoking the table&apos;s
            card here. Twenty wrong codes inside one window also replace the code automatically, so
            guessing is not a way through.
          </p>
        </div>
      </div>

      {!live && (
        <p className="mt-3 rounded-[12px] border border-[var(--alert)]/25 bg-[var(--alert)]/6 px-4 py-3 text-[11.5px] leading-[1.55] text-gink-64">
          <strong className="font-semibold text-gink">Sample floor plan.</strong> The database is not
          connected, so these {tables.length} tables are fictional and cannot be managed. Connect
          Supabase to print and control the real floor.
        </p>
      )}

      {/* --------------------------------------------------------- what it carries */}
      <section aria-labelledby="card-anatomy" className="mt-8" data-table-notes>
        <SectionHead title={<span id="card-anatomy">What a card carries</span>} />
        <Card className="px-5 py-4">
          <p className="m-0 max-w-[70ch] text-[12.5px] leading-[1.55] text-gink-64">
            These are real QR codes. Each encodes a URL containing 256 bits of randomness, bound to one
            table. There is no restaurant name in it to guess at and no expiry on the card itself.
          </p>
          <ul className="mt-3 grid list-none gap-x-6 gap-y-2 p-0 text-[12px] leading-[1.5] text-gink-64 lg:grid-cols-2">
            {[
              'Every table is given a code when it is created — a table cannot exist without one.',
              `A card alone is not enough: the guest also types the six-digit code showing inside the restaurant, which changes every ${minutes}.`,
              'A verified scan creates a session that expires in under an hour; the card keeps working.',
              'An expired or revoked code shows a clear message with a recovery path, never a silent bypass.',
              'Regenerating a table code invalidates the previous one immediately, and ends any session created from it.',
              'Ordering can be disabled per table without touching the menu.',
              '“Print QR sheet” prints one A4 page holding six cards — three across, two down. Print it twice for twelve tables.',
              'No signing keys or admin tokens appear in the QR URL.',
              `The card does not carry the on-site code: that changes every ${minutes}, so printing it would put a dead code on every table. Show the code panel above on a screen, or print that panel separately.`,
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-gink-28" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-[10px] border border-[var(--alert)]/25 bg-[var(--alert)]/6 px-3.5 py-2.5 text-[11.5px] leading-[1.5] text-gink-64">
            Print a fresh sheet after regenerating. The old cards look identical and will simply stop
            working, which is the intended behaviour but is not obvious to a guest holding one.
          </p>
        </Card>
      </section>

      </div>

      {/* --------------------------------------------------------- print sheet
          On screen it is a preview of the A4 page; on paper it is the page. */}
      <section aria-labelledby="print-sheet" className="mt-8 print:mt-0" data-print-sheet>
        <div className="print:hidden">
          <SectionHead title={<span id="print-sheet">Print sheet</span>} meta="6 per A4 page" />
        </div>
        <div className="rounded-[12px] border border-hair bg-card px-4 py-4 print:rounded-none print:border-0 print:p-0">
          <div className="mb-3 text-[10.5px] font-semibold tracking-[0.1em] text-gink-46 uppercase print:hidden">
            Print sheet — 6 per A4 page
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-print-grid>
            {tables.slice(0, 6).map((t) => (
              <div
                key={t.code}
                className="flex flex-col items-center rounded-[10px] border border-hair px-3 py-4 text-center"
              >
                <TableQr svg={t.qrSvg} fallbackValue={`print-${t.code}`} size={64} />
                <div className="mt-2 text-[18px] font-semibold tracking-[0.02em] text-gink">
                  {t.code}
                </div>
                <div className="text-[11.5px] text-gink-64">{restaurantName}</div>
                <div className="mt-1 text-[10.5px] leading-[1.35] text-gink-46">
                  Scan, then enter the code on screen
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </OwnerPage>
  );
}
