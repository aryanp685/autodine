import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableVerifyScreen } from './TableVerifyScreen';

// The action pulls in the Supabase server client, which imports the
// `server-only` marker Next provides at build time. The action's behaviour is
// tested at the boundary in lib/qr-problem.test.ts; here it is the markup that
// matters.
vi.mock('@/app/t/[token]/actions', () => ({
  verifyTableCodeAction: async () => undefined,
}));

/**
 * The screen that stands between a scanned card and a menu.
 *
 * This is where the security change becomes visible to a guest, so the things
 * worth asserting are: it says which table and which restaurant (a form with
 * no context reads as a phishing page), it asks for exactly six digits, it
 * carries the card token in the body rather than the URL, and it never repeats
 * a database message.
 */

const html = renderToStaticMarkup(
  <TableVerifyScreen
    token="qr_abcdefghijklmnop"
    restaurantName="Maddi"
    tableLabel="T3"
    windowMinutes={10}
  />
);

describe('TableVerifyScreen', () => {
  it('says where the guest is, so the form does not look generic', () => {
    expect(html).toContain('Table T3');
    expect(html).toContain('Maddi');
  });

  it('styles the field as the gate’s own control, not the dashboard’s', () => {
    expect(html).toContain('name="code"');
    expect(html).toContain('Open the menu</button>');
    // The app's form classes are for signed-in staff screens; reusing them
    // here is what made this page drift from the rest of the gate.
    expect(html).not.toContain('pg__codeInput');
  });

  it('asks for six digits with a phone keypad', () => {
    expect(html).toContain('name="code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('maxLength="6"');
    expect(html).toContain('pattern="[0-9]{6}"');
  });

  it('posts the card token in the body, not in the action URL', () => {
    expect(html).toContain('type="hidden"');
    expect(html).toContain('value="qr_abcdefghijklmnop"');
    expect(html).not.toContain('/t/qr_abcdefghijklmnop');
  });

  it('tells the guest how long the code lasts', () => {
    expect(html).toContain('changes every 10 minutes');
  });

  it('renders nothing from the database when there is no error', () => {
    expect(html).not.toContain('role="alert"');
  });
});

describe('TableVerifyScreen with an error', () => {
  it('shows the sentence it was given, and keeps the form', () => {
    const withError = renderToStaticMarkup(
      <TableVerifyScreen
        token="qr_abcdefghijklmnop"
        restaurantName="Maddi"
        tableLabel="T3"
        windowMinutes={10}
        error="That code is not correct. Check the screen inside the restaurant and try again."
      />
    );

    expect(withError).toContain('role="alert"');
    expect(withError).toContain('Check the screen inside the restaurant');
    // The form stays: a mistyped digit is fixed by typing it again.
    expect(withError).toContain('name="code"');
  });

  it('does not echo Postgres wording', () => {
    const withError = renderToStaticMarkup(
      <TableVerifyScreen
        token="qr_abcdefghijklmnop"
        restaurantName="Maddi"
        tableLabel="T3"
        windowMinutes={10}
        error="That code is not correct. Check the screen inside the restaurant and try again."
      />
    );

    expect(withError).not.toContain('P0001');
    expect(withError).not.toContain('raise exception');
  });
});
