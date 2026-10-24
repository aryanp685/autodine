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
import { CodeExpiry } from '@/components/owner/CodeExpiry';
import { ConfirmSubmit } from '@/components/owner/ConfirmSubmit';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { Reveal } from '@/components/owner/Reveal';
import {
  OwnerPage,
  PageHead,
  SectionHead,
  Card,
  BtnLink,
  btn,
  selectClass,
  Tag,
  Dot,
  type PillTone,
} from '@/components/owner/chrome';

/** The QR state as a word and a tone. Colour is never the only signal. */
const STATE: Record<string, { tone: PillTone; word: string }> = {
  active: { tone: 'live', word: 'Live' },
  /* Not "Revoked". See the mapping note in lib/db/tables-screen.ts: a table
     that is switched on with no code has nothing to scan, and calling it
     revoked sent an owner looking for who took their code away. */
  'no-code': { tone: 'due', word: 'No code' },
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
                className={`${selectClass} h-8 w-[104px] text-[12.5px]`}
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
              {/* A form that creates rows: pressing twice on a slow network
                  used to create two tables. */}
              <SubmitButton pendingLabel="Adding…" disabled={!live}>
                Add table
              </SubmitButton>
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
                This is what a guest types after scanning a table&apos;s QR — and it is only asked
                for at checkout, so they can read the menu first. It changes every {minutes} by
                itself; there is nothing to remember and nothing to reset.
              </p>
              {/* The one thing that makes the code reachable without staff
                  reading it out: a full-size board for a tablet or TV. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <BtnLink href="/dashboard/display" tone="solid" size="sm">
                  Open guest display
                </BtnLink>
                <form>
                  <SubmitButton tone="ghost" size="sm" formAction={rotateVerificationCodeAction} pendingLabel="Changing…">
                    New code now
                  </SubmitButton>
                </form>
              </div>
              <p className="mt-2.5 max-w-[52ch] text-[11.5px] leading-[1.55] text-gink-46">
                Guests cannot verify? Check that the table they scanned says <em>Live</em> below,
                then read the current code from the display. &ldquo;New code now&rdquo; retires the
                digits on every screen immediately — use it if a code has been shared outside the
                restaurant.
              </p>
            </div>

            <div
              aria-live="polite"
              className="rounded-[12px] border border-hair-strong bg-paper-deep px-5 py-4 text-center"
            >
              <div className="text-[clamp(1.9rem,3.4vw,2.5rem)] leading-none font-medium tracking-[0.16em] text-gink tabular-nums">
                {data.verification.code}
              </div>
              <div className="mt-2">
                <CodeExpiry expiresAt={data.verification.expiresAt} />
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
        <Reveal
          as="ul"
          className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
        >
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
                        size a phone can still read across a table.

                        A live card only ever draws a REAL code. There used to
                        be a fallback here that rendered a QR-shaped pattern
                        when the table had no live code, which is how a table
                        with nothing to scan came to look perfectly fine --
                        and how "Enable does not work" was really "there is no
                        code". Absent means absent, and it is said in words. */}
                    {t.qrSvg ? (
                      <div className="shrink-0 rounded-[10px] border border-hair bg-white p-1.5">
                        <TableQr svg={t.qrSvg} fallbackValue={`${restaurantName}-${t.code}`} size={64} />
                      </div>
                    ) : (
                      <div className="grid h-[78px] w-[78px] shrink-0 place-items-center rounded-[10px] border border-dashed border-hair-strong bg-paper-deep px-1.5 text-center text-[10px] leading-[1.3] font-medium text-gink-46">
                        {live ? 'No code yet' : 'Sample'}
                      </div>
                    )}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-hair pt-2.5">
                    <div>
                      <dt className="text-[10px] font-medium tracking-[0.05em] text-gink-46 uppercase">
                        Last scan
                      </dt>
                      <dd className="mt-0.5 text-[12.5px] text-gink">{t.lastScan}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-medium tracking-[0.05em] text-gink-46 uppercase">
                        Orders today
                      </dt>
                      <dd className="mt-0.5 text-[12.5px] text-gink tabular-nums">{t.orders}</dd>
                    </div>
                  </dl>

                  {live && t.id ? (
                    /*
                     * One form per card: every button shares the hidden table
                     * id and overrides only the action, so all of them are
                     * real submissions rather than inert spans.
                     *
                     * WHICH ACTIONS APPEAR DEPENDS ON THE STATE
                     *
                     * Four buttons on every card meant three of them did
                     * nothing useful most of the time: "Regenerate" and
                     * "Revoke" on a card with no code are both no-ops, and
                     * "Enable" on a table that has no code left the owner with
                     * a switched-on table nobody could scan -- which is exactly
                     * the bug that was reported as "Enable does not work".
                     *
                     * So a card offers the one next step it actually needs,
                     * as the solid button, and the secondary options beside
                     * it.
                     */
                    <form className="mt-auto flex flex-wrap items-center gap-1 pt-3">
                      <input type="hidden" name="tableId" value={t.id} />

                      {t.qr === 'no-code' && (
                        /* The code is what is missing, so creating one is the
                           primary action, not an afterthought behind
                           "Regenerate". */
                        <SubmitButton
                          formAction={rotateQrAction}
                          data-table-action="create"
                          pendingLabel="Creating…"
                        >
                          Create code
                        </SubmitButton>
                      )}

                      {t.qr === 'disabled' && (
                        /* Enabling issues a code first when there is none --
                           see setTableActiveAction. A switched-on table with
                           nothing to scan is not a success. */
                        <SubmitButton
                          formAction={setTableActiveAction}
                          name="active"
                          value="true"
                          data-table-action="toggle"
                          pendingLabel="Enabling…"
                        >
                          Enable
                        </SubmitButton>
                      )}

                      {/* Preview opens the card's own URL, which is what a
                          guest actually sees: the verification form, not a
                          menu. Useless with no code, so it is not offered. */}
                      {t.qr !== 'no-code' && (
                        <a
                          href={t.scanUrl ?? '/menu'}
                          target="_blank"
                          rel="noreferrer"
                          data-table-action="preview"
                          className={btn('quiet', 'sm')}
                        >
                          Preview
                        </a>
                      )}

                      {t.qr === 'active' && (
                        <>
                          <SubmitButton
                            formAction={rotateQrAction}
                            data-table-action="rotate"
                            tone="quiet"
                            pendingLabel="Replacing…"
                          >
                            Regenerate
                          </SubmitButton>
                          <SubmitButton
                            formAction={setTableActiveAction}
                            name="active"
                            value="false"
                            data-table-action="toggle"
                            tone="quiet"
                            pendingLabel="Disabling…"
                          >
                            Disable
                          </SubmitButton>
                          {/* Revoking is not like disabling. The card taped to
                              the table stops working and someone has to print,
                              laminate and re-stick a new one -- so it asks, and
                              the question names the table. */}
                          <ConfirmSubmit
                            formAction={revokeQrAction}
                            data-table-action="revoke"
                            tone="danger"
                            question={`Revoke ${t.code}? Its printed card stops working.`}
                            confirmLabel="Revoke it"
                            className="ml-auto"
                          >
                            Revoke
                          </ConfirmSubmit>
                        </>
                      )}

                      {t.qr === 'disabled' && t.token && (
                        <SubmitButton
                          formAction={rotateQrAction}
                          data-table-action="rotate"
                          tone="quiet"
                          pendingLabel="Replacing…"
                        >
                          New code
                        </SubmitButton>
                      )}
                    </form>
                  ) : (
                    /* No database, no controls: four dead buttons under every
                       card taught that the codes were manageable. */
                    <p className="mt-auto pt-3 text-[11.5px] leading-[1.45] text-gink-46">
                      Sample card — connect the database to manage codes.
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </Reveal>
      </section>

      {/* -------------------------------------------------------------- notes
          Two statements, kept: how a scan works, and what it cannot do. The
          second is the one a restaurant will only discover the hard way. */}
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <div className="rounded-[12px] border border-hair bg-card px-4 py-3.5">
          <strong className="text-[12.5px] font-semibold text-gink">How a scan works</strong>
          <p className="mt-1 text-[11.5px] leading-[1.55] text-gink-64">
            The card on the table carries an unguessable token, not a link to the restaurant. Scanning
            it opens a short form that asks for the six-digit code above, and only then is a session
            created — bound to that one table, and expiring in under an hour, so an order placed from
            it is stamped with the table it was placed at. Each restaurant gets its own cards and its
            own code: one restaurant&apos;s card will not scan into another.
          </p>
        </div>
        <div className="rounded-[12px] border border-[var(--alert)]/25 bg-[var(--alert)]/6 px-4 py-3.5">
          <strong className="text-[12.5px] font-semibold text-gink">Honest limitation</strong>
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
          <ul className="mt-3 grid list-none gap-x-6 gap-y-2 p-0 text-[12.5px] leading-[1.5] text-gink-64 lg:grid-cols-2">
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
                {t.qrSvg ? (
                  <TableQr svg={t.qrSvg} fallbackValue={`print-${t.code}`} size={64} />
                ) : (
                  /* Printing a card for a table with no code puts an
                     unscannable square on a table and looks exactly like a
                     working one. The sheet says what is missing instead. */
                  <div className="grid size-[64px] place-items-center rounded-[6px] border border-dashed border-hair-strong px-1 text-center text-[10px] leading-[1.2] font-medium text-gink-46">
                    No code
                  </div>
                )}
                <div className="mt-2 text-[18px] font-semibold tracking-[0.02em] text-gink">
                  {t.code}
                </div>
                <div className="text-[11.5px] text-gink-64">{restaurantName}</div>
                <div className="mt-1 text-[10.5px] leading-[1.35] text-gink-46">
                  {t.qrSvg ? 'Scan, then enter the code on screen' : 'Create a code first'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </OwnerPage>
  );
}
