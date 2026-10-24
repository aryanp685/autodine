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
  BtnLink,
  Card,
  Dot,
  Empty,
  Notice,
  OwnerPage,
  PageHead,
  SectionHead,
  Tag,
  btn,
  selectClass,
  type PillTone,
} from '@/components/owner/chrome';

/**
 * TABLES & QR — the floor, and what is on each table.
 *
 * WHAT THIS SCREEN IS FOR
 *
 * Two questions, in this order: what code do I read to a guest right now, and
 * which table's card needs attention. Everything else on the page is the
 * explanation an owner needs once and then scrolls past.
 *
 * WHY IT WAS REBUILT
 *
 * It was flat: a heading, a strip of prose, and twelve cards of equal weight
 * with four buttons along the bottom of each. Nothing on it said which table
 * was fine and which one could not take an order, so the owner had to read
 * every card. The code — the only thing on the page with a deadline — sat in
 * a box at the same weight as the paragraphs about it.
 *
 * WHAT CHANGED, AND WHY EACH ONE IS NOT DECORATION
 *
 *   - The code panel is a two-column card: the instructions on paper, the six
 *     digits on their own plate with the countdown under them. It is the one
 *     number staff read out loud, so it is set at display size and it is
 *     `aria-live` — when it rolls on its own, a screen reader hears the new
 *     one.
 *   - The floor comes second and carries the state in a tag, the seat count in
 *     words, and one row of actions. A healthy table offers no solid button:
 *     ink is reserved for the card that needs a decision ("Create code",
 *     "Enable"), so a page of twelve tables has a hierarchy instead of twelve
 *     equal black buttons.
 *   - A banner names the tables that cannot be scanned. Before, that fact was
 *     buried in the card's tag twelve times over.
 *   - Printing prints the whole floor, six cards to a page. It used to print
 *     the first six on every press while the copy said "print it twice for
 *     twelve tables" — the second sheet was the same six cards.
 *
 * WHAT DID NOT CHANGE
 *
 * The actions, their order and their guards are exactly as they were: one form
 * per card, the hidden table id, `formAction` overriding the action, the state
 * that decides which buttons appear, the confirm on revoke, and no controls at
 * all on the sample floor plan. Every claim below is still true of the server
 * code behind it.
 */

/** The QR state as a word and a tone. Colour is never the only signal. */
const STATE: Record<string, { tone: PillTone; word: string }> = {
  active: { tone: 'live', word: 'Live' },
  /* Not "Revoked". See the mapping note in lib/db/tables-screen.ts: a table
     that is switched on with no code has nothing to scan, and calling it
     revoked sent an owner looking for who took their code away. */
  'no-code': { tone: 'due', word: 'No code' },
  disabled: { tone: 'neutral', word: 'Disabled' },
};

/** Cards to an A4 page: three across, two down. */
const PER_PAGE = 6;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
  const minutes = plural(codeMinutes, 'minute', 'minutes');

  const liveCount = tables.filter((t) => t.qr === 'active').length;
  const codeless = live ? tables.filter((t) => t.qr === 'no-code') : [];

  /* Pages of six, so the printed sheet and the screen agree about what prints. */
  const pages: TableRow[][] = [];
  for (let i = 0; i < tables.length; i += PER_PAGE) pages.push(tables.slice(i, i + PER_PAGE));

  return (
    <OwnerPage active="tables" outlet={outlet}>
      {/* Everything except the sheet is screen-only. The sheet is print-only.
          Tailwind's `print:` variant is the whole of that rule, so it holds
          without a stylesheet knowing any of these class names. */}
      <div className="print:hidden">
        <PageHead
          kicker="Tables & QR"
          title={restaurantName}
          meta={
            live
              ? `${plural(tables.length, 'table', 'tables')} on the floor, each with its own card. Regenerating a code stops the printed card at once.`
              : 'Sample floor plan — fictional tables showing the states a real floor can be in. No code is drawn here, and nothing can be managed until a database is connected.'
          }
          actions={
            <>
              <PrintButton className={btn('ghost', 'md')}>Print QR sheet</PrintButton>
              {/* Without a database this submit could only fail, so the whole
                  form is absent rather than present-and-disabled: a greyed
                  control with no way to fix it is a dead end with a border. */}
              {live ? (
                <form action={addTableAction} className="flex items-center gap-1.5">
                  <select
                    className={`${selectClass} w-[122px]`}
                    name="seats"
                    defaultValue="4"
                    aria-label="Seats at the new table"
                  >
                    {[2, 4, 6, 8, 10].map((n) => (
                      <option key={n} value={n}>
                        {n} seats
                      </option>
                    ))}
                  </select>
                  {/* A form that creates rows: pressing twice on a slow
                      network used to create two tables. */}
                  <SubmitButton pendingLabel="Adding…" size="md">
                    Add table
                  </SubmitButton>
                </form>
              ) : null}
            </>
          }
        />

        {data?.blocked && <SignInPrompt reason={data.blocked} screen="tables and QR screen" />}

        {error ? (
          <Notice tone="due" label="Could not update tables." role="alert">
            {error}
          </Notice>
        ) : null}
        {notice ? (
          <Notice tone="accent" label="Saved." role="status">
            {notice}
          </Notice>
        ) : null}

        {/* The one thing on this screen that needs a decision today, said once
            instead of twelve times. */}
        {codeless.length > 0 ? (
          <Notice
            tone="due"
            label={`${plural(codeless.length, 'table has', 'tables have')} no code`}
            action={
              <span className="text-[11.5px] text-gink-46">Create one on the card below</span>
            }
          >
            {codeless.map((t) => t.code).join(', ')} — nobody can scan in at these, so nobody can
            order from them until a code is created.
          </Notice>
        ) : null}

        {!live && !data?.blocked ? (
          <Notice tone="plain" label="Sample floor plan.">
            These {tables.length} tables are fictional and cannot be managed. Connect Supabase to
            print and control the real floor.
          </Notice>
        ) : null}

        {/* --------------------------------------------------- the on-site code
            The one thing on this screen that is shown to guests, so it is the
            one thing set in display type. Everything around it is instructions,
            and it sits on its own plate so the digits can be read from across a
            counter. */}
        {data?.verification ? (
          <Card className="mb-4 overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1fr)_272px]">
              <div className="px-5 py-5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <Dot tone="live" />
                  <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-gink">
                    On-site code
                  </h2>
                  <Tag tone="neutral">Changes every {minutes}</Tag>
                </div>
                <p className="mt-2 max-w-[54ch] text-[12.5px] leading-[1.55] text-gink-64">
                  This is what a guest types after scanning a table&apos;s QR — and it is only
                  asked for at checkout, so they can read the menu first. It changes every{' '}
                  {minutes} by itself; there is nothing to remember and nothing to reset.
                </p>
                {/* The one thing that makes the code reachable without staff
                    reading it out: a full-size board for a tablet or TV. */}
                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                  <BtnLink href="/dashboard/display" tone="solid" size="sm">
                    Open guest display
                  </BtnLink>
                  <form>
                    <SubmitButton
                      tone="ghost"
                      size="sm"
                      formAction={rotateVerificationCodeAction}
                      pendingLabel="Changing…"
                    >
                      New code now
                    </SubmitButton>
                  </form>
                </div>
                <p className="mt-3 max-w-[54ch] text-[11.5px] leading-[1.55] text-gink-46">
                  Guests cannot verify? Check that the table they scanned says <em>Live</em> below,
                  then read the current code from the display. &ldquo;New code now&rdquo; retires
                  the digits on every screen immediately — use it if a code has been shared
                  outside the restaurant.
                </p>
              </div>

              {/* The plate. A fixed column rather than a flex item so the
                  digits do not move when the sentence beside them reflows. */}
              <div className="flex flex-col justify-center border-t border-hair bg-paper-deep px-5 py-6 text-center lg:border-t-0 lg:border-l">
                <div
                  aria-live="polite"
                  className="text-[30px] leading-none font-semibold tracking-[0.16em] text-gink tabular-nums"
                >
                  {data.verification.code}
                </div>
                <div className="mt-2.5 flex justify-center">
                  <CodeExpiry expiresAt={data.verification.expiresAt} />
                </div>
                <p className="mt-2 text-[11.5px] leading-[1.4] text-gink-46">
                  Type it at checkout, not at the table.
                </p>
              </div>
            </div>
          </Card>
        ) : null}

        {data?.verificationError ? (
          <Notice tone="due" label="The on-site code is not available." role="alert">
            {data.verificationError}
          </Notice>
        ) : null}

        {/* --------------------------------------------------------- floor plan */}
        <section aria-labelledby="floor-plan">
          <SectionHead
            title={<span id="floor-plan">The floor</span>}
            meta={
              live
                ? plural(liveCount, 'table live', 'tables live')
                : `${plural(tables.length, 'table', 'tables')} · sample`
            }
          />

          {live && tables.length === 0 && !data?.blocked ? (
            <Empty>
              No tables yet. Add one with the seat count above and its QR card is created with it —
              then print the sheet and put it on the table.
            </Empty>
          ) : (
            <Reveal
              as="ul"
              className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
            >
              {tables.map((t) => {
                const state = STATE[t.qr] ?? { tone: 'neutral' as PillTone, word: t.qr };
                return (
                  <li key={t.code}>
                    <Card className="flex h-full flex-col overflow-hidden">
                      <div className="flex items-start justify-between gap-3 px-4 pt-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[17px] font-semibold tracking-[-0.02em] text-gink">
                              {t.code}
                            </span>
                            <Tag tone={state.tone}>{state.word}</Tag>
                          </div>
                          {/* `label` is already "4 seater": printing the seat
                              count after it read "4 seater · 4 seats". */}
                          <div className="mt-1 text-[11.5px] leading-[1.45] text-gink-46">
                            {t.label}
                          </div>
                        </div>
                        {/* The code is the card's whole point, so it is drawn
                            at a size a phone can still read across a table.

                            A live card only ever draws a REAL code. There used
                            to be a fallback here that rendered a QR-shaped
                            pattern when the table had no live code, which is
                            how a table with nothing to scan came to look
                            perfectly fine -- and how "Enable does not work"
                            was really "there is no code". Absent means absent,
                            and it is said in words. */}
                        {t.qrSvg ? (
                          <div className="shrink-0 rounded-[10px] border border-hair bg-white p-1.5">
                            <TableQr
                              svg={t.qrSvg}
                              fallbackValue={`${restaurantName}-${t.code}`}
                              size={64}
                            />
                          </div>
                        ) : (
                          <div className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-[10px] border border-dashed border-hair-strong bg-paper-deep px-1.5 text-center text-[10px] leading-[1.3] font-medium text-gink-46">
                            {!live ? 'Sample' : t.token ? 'Code not drawn' : 'No code yet'}
                          </div>
                        )}
                      </div>

                      <dl className="mx-4 mt-3.5 grid grid-cols-2 gap-2 border-t border-hair pt-3">
                        <div>
                          <dt className="text-[10.5px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
                            Last scan
                          </dt>
                          <dd className="mt-0.5 text-[12.5px] text-gink">{t.lastScan}</dd>
                        </div>
                        <div>
                          <dt className="text-[10.5px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
                            Orders today
                          </dt>
                          <dd className="mt-0.5 text-[12.5px] text-gink tabular-nums">{t.orders}</dd>
                        </div>
                      </dl>

                      {live && t.id ? (
                        /*
                         * One form per card: every button shares the hidden
                         * table id and overrides only the action, so all of
                         * them are real submissions rather than inert spans.
                         *
                         * WHICH ACTIONS APPEAR DEPENDS ON THE STATE
                         *
                         * Four buttons on every card meant three of them did
                         * nothing useful most of the time: "Regenerate" and
                         * "Revoke" on a card with no code are both no-ops, and
                         * "Enable" on a table that has no code left the owner
                         * with a switched-on table nobody could scan -- which
                         * is exactly the bug that was reported as "Enable does
                         * not work".
                         *
                         * So a card offers the one next step it actually needs,
                         * as the solid button, and the secondary options
                         * beside it. A healthy card has no solid button at
                         * all: ink means "this one wants something from you".
                         */
                        <form className="mt-auto flex flex-wrap items-center gap-1 border-t border-hair bg-[rgba(25,20,17,0.018)] px-2.5 py-2">
                          <input type="hidden" name="tableId" value={t.id} />

                          {t.qr === 'no-code' && (
                            /* The code is what is missing, so creating one is
                               the primary action, not an afterthought behind
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
                            /* Enabling issues a code first when there is none
                               -- see setTableActiveAction. A switched-on table
                               with nothing to scan is not a success. */
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
                              {/* Revoking is not like disabling. The card taped
                                  to the table stops working and someone has to
                                  print, laminate and re-stick a new one -- so it
                                  asks, and the question names the table. */}
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
                        /* No database, no controls: four dead buttons under
                           every card taught that the codes were manageable. */
                        <p className="mt-auto border-t border-hair px-4 py-2.5 text-[11.5px] leading-[1.45] text-gink-46">
                          Sample card — connect the database to manage codes.
                        </p>
                      )}
                    </Card>
                  </li>
                );
              })}
            </Reveal>
          )}
        </section>

        {/* -------------------------------------------------------------- notes
            Two statements, kept: how a scan works, and what it cannot do. The
            second is the one a restaurant will only discover the hard way. */}
        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          <Card className="px-5 py-4">
            <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-gink">
              How a scan works
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-[1.55] text-gink-64">
              The card on the table carries an unguessable token, not a link to the restaurant.
              Scanning it opens a short form that asks for the six-digit code above, and only then
              is a session created — bound to that one table, and expiring in under an hour, so an
              order placed from it is stamped with the table it was placed at. Each restaurant gets
              its own cards and its own code: one restaurant&apos;s card will not scan into another.
            </p>
          </Card>
          <Card className="border-[color-mix(in_oklab,var(--alert)_22%,transparent)] px-5 py-4">
            <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-gink">
              Honest limitation
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-[1.55] text-gink-64">
              Somebody in the room can read the code out to somebody outside on the phone. A shared
              code is a deterrent, not proof of presence — no design that a seated guest has to be
              able to use can be proof. What it does buy is that the leak has to be live and human,
              that it dies within {minutes}, and that the session it produced can be ended by
              revoking the table&apos;s card here. Twenty wrong codes inside one window also replace
              the code automatically, so guessing is not a way through.
            </p>
          </Card>
        </div>

        {/* ------------------------------------------------- what it carries */}
        <section aria-labelledby="card-anatomy" className="mt-7" data-table-notes>
          <SectionHead title={<span id="card-anatomy">What a card carries</span>} />
          <Card className="px-5 py-4">
            <p className="m-0 max-w-[70ch] text-[12.5px] leading-[1.55] text-gink-64">
              {live
                ? 'These are real QR codes. Each encodes a URL containing 256 bits of randomness, bound to one table. There is no restaurant name in it to guess at and no expiry on the card itself.'
                : 'On a connected floor each card carries a real QR code: a URL with 256 bits of randomness, bound to one table, with no restaurant name to guess at and no expiry on the card itself. Nothing is drawn on this sample floor.'}
            </p>
            <ul className="mt-3 grid list-none gap-x-6 gap-y-2 p-0 text-[12.5px] leading-[1.5] text-gink-64 lg:grid-cols-2">
              {[
                'Every table is given a code when it is created — a table cannot exist without one.',
                `A card alone is not enough: the guest also types the six-digit code showing inside the restaurant, which changes every ${minutes}.`,
                'A verified scan creates a session that expires in under an hour; the card keeps working.',
                'An expired or revoked code shows a clear message with a recovery path, never a silent bypass.',
                'Regenerating a table code invalidates the previous one immediately, and ends any session created from it.',
                'Ordering can be disabled per table without touching the menu.',
                '“Print QR sheet” prints every table on the floor, six cards to an A4 page — three across, two down, then a page break. Nothing is silently left out.',
                'No signing keys or admin tokens appear in the QR URL.',
                `The card does not carry the on-site code: that changes every ${minutes}, so printing it would put a dead code on every table. Show the code panel above on a screen, or print that panel separately.`,
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] size-1 shrink-0 rounded-full bg-[var(--p-accent)]"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>

      {/* ----------------------------------------------------------- print sheet
          On screen it is a preview of the A4 pages; on paper they are the pages.
          It sits OUTSIDE the `print:hidden` wrapper above for exactly that
          reason -- and the wrapper's closing tag must stay above it. */}
      <section aria-labelledby="print-sheet" className="mt-7 print:mt-0" data-print-sheet>
        <div className="print:hidden">
          <SectionHead
            title={<span id="print-sheet">Print sheet</span>}
            meta={`${plural(pages.length, 'A4 page', 'A4 pages')} · six cards each`}
          />
          <Notice tone="due" label="Print a fresh sheet after regenerating." className="mb-3">
            The old cards look identical and will simply stop working, which is the intended
            behaviour but is not obvious to a guest holding one.
          </Notice>
        </div>
        <Card className="px-4 py-4 print:rounded-none print:border-0 print:p-0">
          {pages.map((page, index) => (
            <div
              key={index}
              data-print-grid
              className={[
                'grid grid-cols-2 gap-4 sm:grid-cols-3',
                index < pages.length - 1 ? 'mb-4 print:mb-0 print:break-after-page' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {page.map((t) => (
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
                    {t.qrSvg
                      ? 'Scan, then enter the code on screen'
                      : t.token
                        ? 'Regenerate this code'
                        : 'Create a code first'}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </Card>
      </section>
    </OwnerPage>
  );
}
