import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TablesScreen } from './TablesScreen';
import type { TablesScreenData } from '@/lib/db/tables-screen';

// The actions pull in the Supabase server client (and the `server-only`
// marker), and the refresh helper is a client component that needs a Next
// router. Neither is what this test is about: it is about what a member of
// staff can SEE on the screen they have to read a code off.
vi.mock('@/app/dashboard/tables/actions', () => ({
  addTableAction: async () => undefined,
  revokeQrAction: async () => undefined,
  rotateQrAction: async () => undefined,
  rotateVerificationCodeAction: async () => undefined,
  setTableActiveAction: async () => undefined,
}));

vi.mock('@/components/VerificationCodeRefresh', () => ({
  VerificationCodeRefresh: () => null,
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
