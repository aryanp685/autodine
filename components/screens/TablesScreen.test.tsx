import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TablesScreen } from './TablesScreen';
import type { TablesScreenData } from '@/lib/db/tables-screen';

// The actions pull in the Supabase server client (and the `server-only`
// marker), and the refresh helper is a client component that needs a Next
// router. Neither is what this test is about: it is about what a member of
// staff can SEE on the screen they have to read a code off.
vi.mock('@/app/(staff)/dashboard/tables/actions', () => ({
  addTableAction: async () => undefined,
  revokeQrAction: async () => undefined,
  rotateQrAction: async () => undefined,
  rotateVerificationCodeAction: async () => undefined,
  setTableActiveAction: async () => undefined,
}));

vi.mock('@/components/owner/CodeExpiry', () => ({
  // It needs a mounted app router (useRouter) and a clock; the panel's text is
  // what these tests are about, not the countdown.
  CodeExpiry: () => null,
}));

/**
 * The on-site code is the second half of the scan: without it, no guest can
 * verify and no order can be placed. So the one thing this screen must never do
 * is fail to show it -- or show a stale one without saying it changes.
 */

function data(over: Partial<TablesScreenData> = {}): TablesScreenData {
  return {
    restaurantName: 'Maddi',
    tables: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        code: 'T1',
        label: '4 seater',
        seats: 4,
        qr: 'active',
        lastScan: '—',
        orders: 0,
        token: 'qr_abcdefghijklmnop',
        scanUrl: 'https://example.test/t/qr_abcdefghijklmnop',
        qrSvg: null,
      },
    ],
    verification: {
      code: '948111',
      expiresAt: '2026-10-22T10:10:00.000Z',
      windowSeconds: 600,
    },
    ...over,
  };
}

/**
 * THE BUG THIS SUITE NOW GUARDS
 *
 * Production had a table that was switched on with no live code: its last code
 * had been retired, so there was nothing to scan. The screen called that state
 * "Revoked", drew a QR-shaped pattern in the corner, and offered Enable --
 * pressing which flipped the table on and changed nothing anyone could see.
 * The report that came back was "Enable does not work".
 *
 * Three properties, all checkable from the server's markup:
 *   - the state is named in words a person can act on ("No code");
 *   - the card never draws a code that cannot be scanned;
 *   - the action offered is the one that fixes it ("Create code").
 */
describe('a table with no live code', () => {
  const codeless = data({
    tables: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        code: 'T1',
        label: '4 seater',
        seats: 4,
        qr: 'no-code',
        lastScan: '—',
        orders: 0,
        token: null,
        scanUrl: null,
        qrSvg: null,
      },
    ],
  });

  it('says "No code" rather than "Revoked"', () => {
    const html = renderToStaticMarkup(<TablesScreen data={codeless} />);

    expect(html).toContain('No code');
    expect(html).not.toContain('Revoked');
  });

  it('offers the action that fixes it, and not the ones that cannot', () => {
    const html = renderToStaticMarkup(<TablesScreen data={codeless} />);

    expect(html).toContain('Create code');
    // Regenerating nothing and previewing nothing are both no-ops.
    expect(html).not.toContain('data-table-action="rotate"');
    expect(html).not.toContain('data-table-action="preview"');
  });

  it('does not print a card for a table that cannot be scanned', () => {
    const html = renderToStaticMarkup(<TablesScreen data={codeless} />);

    // The print sheet is the dangerous one: a pattern on paper looks exactly
    // like a working card until a guest tries it.
    expect(html).toContain('Create a code first');
    expect(html).not.toContain('Scan, then enter the code on screen');
  });
});

describe('TablesScreen', () => {
  it('shows the six digits staff have to read out', () => {
    const html = renderToStaticMarkup(<TablesScreen data={data()} />);

    expect(html).toContain('On-site code');
    expect(html).toContain('948111');
  });

  it('says how often the code changes, from the database window', () => {
    const html = renderToStaticMarkup(<TablesScreen data={data()} />);
    expect(html).toContain('10 minutes');

    const faster = renderToStaticMarkup(
      <TablesScreen
        data={data({
          verification: {
            code: '111111',
            expiresAt: '2026-10-22T10:05:00.000Z',
            windowSeconds: 300,
          },
        })}
      />
    );
    expect(faster).toContain('5 minutes');
  });

  it('offers a way to kill a code that leaked before the window ended', () => {
    const html = renderToStaticMarkup(<TablesScreen data={data()} />);
    expect(html).toContain('New code now');
  });

  it('does not pretend to have a code when it could not read one', () => {
    // An empty box where a code belongs reads as "broken"; the alert says what
    // is actually true and what it costs.
    const html = renderToStaticMarkup(
      <TablesScreen
        data={data({
          verification: null,
          verificationError:
            'The on-site code could not be read. Guests will not be able to verify until it is.',
        })}
      />
    );

    expect(html).not.toContain('On-site code');
    expect(html).toContain('Guests will not be able to verify');
  });

  it('shows no panel at all on the sample floor plan', () => {
    // Demo mode has no database, so there is no real code to show, and a
    // fictional set of digits is worse than none.
    const html = renderToStaticMarkup(<TablesScreen data={null} />);

    expect(html).not.toContain('On-site code');
    expect(html).toContain('Sample floor plan');
  });

  it('does not dress the sample floor plan in controls that do nothing', () => {
    // Demo mode once rendered Preview / Regenerate / Enable / Revoke as <span>s
    // styled identically to the real buttons -- four things per card that
    // looked tappable and were not.
    const html = renderToStaticMarkup(<TablesScreen data={null} />);

    expect(html).not.toContain('data-table-action');
    expect(html).not.toContain('Regenerate');
    expect(html).toContain('Sample card');
    expect(html).toContain('cannot be managed');
  });

  it('keeps the card explanation on screen and out of the print sheet', () => {
    const html = renderToStaticMarkup(<TablesScreen data={data()} />);

    // The copy used to live in an aside next to the print sheet; the sheet is
    // print-only, so the explanation was the only part of that row people saw.
    expect(html).toContain('data-table-notes');
    expect(html).toContain('What a card carries');
    expect(html).toContain('256 bits of randomness');
    expect(html).toContain('data-print-sheet');
  });

  it('previews what a guest sees: the card, not the menu', () => {
    const html = renderToStaticMarkup(<TablesScreen data={data()} />);
    expect(html).toContain('href="https://example.test/t/qr_abcdefghijklmnop"');
  });
});

/**
 * THE REDESIGN
 *
 * The screen answers two questions — which code do I read out, and which table
 * needs something — and the tests below are about that order being visible in
 * the markup rather than only in the copy.
 *
 * Two of them guard real regressions rather than taste:
 *
 *   - the print sheet must sit OUTSIDE the `print:hidden` wrapper. It is one
 *     closing tag away from printing a blank page, and nothing on screen would
 *     look wrong if it did.
 *   - printing must cover the whole floor. It used to print the first six cards
 *     on every press while the copy told the owner to "print it twice for twelve
 *     tables" — the second sheet was the same six.
 */

function table(over: Partial<TablesScreenData['tables'][number]> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'T1',
    label: '4 seater',
    seats: 4,
    qr: 'active' as const,
    lastScan: '—',
    orders: 0,
    token: 'qr_abcdefghijklmnop',
    scanUrl: 'https://example.test/t/qr_abcdefghijklmnop',
    qrSvg: null,
    ...over,
  };
}

/** The print sheet is the last thing on the page, so everything after its
    marker is the sheet. */
const printSheet = (html: string) => html.slice(html.indexOf('data-print-sheet'));

/** Where the `print:hidden` wrapper closes, by matching its own div tags. */
function printHiddenClosesAt(html: string): number {
  const start = html.indexOf('<div class="print:hidden">');
  if (start === -1) return -1;
  let depth = 0;
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = start;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('the redesign', () => {
  it('gives the six digits their own plate, announced when they roll', () => {
    const html = renderToStaticMarkup(<TablesScreen data={data()} />);
    const plate = html.slice(html.indexOf('aria-live="polite"'));

    expect(html).toContain('On-site code');
    // Display type, not body type: this is the one number read across a room.
    expect(plate.slice(0, 400)).toContain('text-[30px]');
    expect(plate.slice(0, 400)).toContain('948111');
        // The countdown lives under the digits, not across the page from them.
    expect(plate.slice(0, 900)).toContain('Type it at checkout');
  });

  it('reserves the filled action for the table that needs a decision', () => {
    // Two filled controls are the page's own: "Add table" in the head and
    // "Open guest display" beside the code. No card draws one while every
    // table is healthy -- twelve filled buttons under twelve healthy tables is
    // how the screen told the owner nothing. The fill is the accent now, not
    // the ink: one action colour in the product (btn() in the kit).
    const healthy = renderToStaticMarkup(
      <TablesScreen data={data({ tables: [table({}), table({ code: 'T2' })] })} />
    );
    expect(count(healthy, 'bg-[var(--p-accent)] text-onink')).toBe(2);

    // One table without a code: it, and only it, gains a solid button.
    const broken = renderToStaticMarkup(
      <TablesScreen
        data={data({
          tables: [table({}), table({ code: 'T8', qr: 'no-code', token: null, scanUrl: null })],
        })}
      />
    );
    expect(count(broken, 'bg-[var(--p-accent)] text-onink')).toBe(3);
    expect(broken).toContain('data-table-action="create"');
  });

  it('names the tables that cannot take an order, once', () => {
    const html = renderToStaticMarkup(
      <TablesScreen
        data={data({
          tables: [
            table({ code: 'T1' }),
            table({ code: 'T8', qr: 'no-code' }),
            table({ code: 'T9', qr: 'no-code' }),
          ],
        })}
      />
    );

    expect(html).toContain('2 tables have no code');
    expect(html).toContain('T8, T9');
  });

  it('says nothing about missing codes on a floor that has none missing', () => {
    const html = renderToStaticMarkup(<TablesScreen data={data()} />);
    expect(html).not.toContain('tables have no code');
  });

  it('offers no add-table form on the sample floor plan', () => {
    // A disabled select and a disabled submit are a dead end with a border.
    const html = renderToStaticMarkup(<TablesScreen data={null} />);
    expect(html).not.toContain('Add table');
    expect(html).not.toContain('name="seats"');
    expect(html).toContain('Print QR sheet');
  });

  it('says the floor is empty instead of drawing an empty grid', () => {
    const html = renderToStaticMarkup(<TablesScreen data={data({ tables: [] })} />);
    expect(html).toContain('No tables yet');
  });

  it('keeps the print sheet out of the print:hidden wrapper', () => {
    // If it moves inside, the page prints blank -- and looks perfect on screen.
    const html = renderToStaticMarkup(<TablesScreen data={data()} />);
    const closes = printHiddenClosesAt(html);

    expect(closes).toBeGreaterThan(-1);
    expect(html.indexOf('data-print-sheet')).toBeGreaterThan(closes);
  });

  it('prints the whole floor, six cards to a page', () => {
    const eight = Array.from({ length: 8 }, (_, i) =>
      table({ code: `T${i + 1}`, id: `11111111-1111-1111-1111-11111111111${i}` })
    );
    const sheet = printSheet(renderToStaticMarkup(<TablesScreen data={data({ tables: eight })} />));

    for (let i = 1; i <= 8; i++) expect(sheet).toContain(`T${i}`);
    expect(count(sheet, 'data-print-grid')).toBe(2);
    // One break, between the pages -- not after the last one, which would print
    // a blank second sheet.
    expect(count(sheet, 'print:break-after-page')).toBe(1);
  });

  it('tells a missing code apart from one that would not draw', () => {
    // Both render no square, and they need opposite actions: one needs a code
    // created, the other a code regenerated. Calling the second "No code yet"
    // is a false statement about the table.
    const html = renderToStaticMarkup(
      <TablesScreen
        data={data({ tables: [table({ qr: 'active', token: 'qr_abcdefghijklmnop', qrSvg: null })] })}
      />
    );

    expect(html).toContain('Code not drawn');
    expect(html).not.toContain('No code yet');
    expect(printSheet(html)).toContain('Regenerate this code');
  });

  it('says what a missing code costs: the table cannot take an order', () => {
    const html = renderToStaticMarkup(
      <TablesScreen data={data({ tables: [table({ code: 'T8', qr: 'no-code', token: null })] })} />
    );
    // "orders will not be stamped with a table" was wrong: with no way to scan
    // in, there is no order at that table at all.
    expect(html).toContain('nobody can order from them');
  });

  it('does not claim the sample floor plan carries working codes', () => {
    const html = renderToStaticMarkup(<TablesScreen data={null} />);
    // It used to say "real QR codes", directly above twelve cards that draw no
    // code at all.
    expect(html).not.toContain('real QR codes');
    expect(html).toContain('No code is drawn here');
  });

  it('labels the sheet once, with a page count that matches', () => {
    const html = renderToStaticMarkup(<TablesScreen data={data()} />);
    // It used to be titled in the section head AND on the sheet itself.
    expect(html).not.toContain('Print sheet — 6 per A4 page');
    expect(html).toContain('A4 page · six cards each');
  });
});
