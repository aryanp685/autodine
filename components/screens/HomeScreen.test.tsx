import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Home } from './HomeScreen';
import { PricingScreen } from './PricingScreen';
import { LIVE, NOT_CONNECTED, DIFFERENCES } from '@/lib/plans';

/**
 * The marketing pages' claims, pinned.
 *
 * These are not visual tests. They exist because the two things this pair of
 * pages got wrong were claims, not pixels:
 *
 *   1. A sample-menu detour in place of showing the product. It is gone, and
 *      nothing here may bring it back.
 *   2. Counts typed by hand into headlines ("Six things work. Three do not."),
 *      which stay true only until somebody edits one of the lists. They are
 *      derived now, and this asserts the derivation.
 */
const home = renderToStaticMarkup(<Home />);
const pricing = renderToStaticMarkup(<PricingScreen />);

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

describe('home', () => {
  it('does not offer a sample menu', () => {
    expect(home).not.toContain('/demo/menu');
    expect(home).not.toContain('sample menu');
  });

  it('shows the product instead, as three real screens', () => {
    expect(home).toContain('data-tour-panel');
    expect(home.match(/data-tour-panel/g)?.length).toBe(3);
    expect(home).toContain('Three screens, in service order.');
  });

  it('counts the build from the lists it renders', () => {
    const line = `${cap(WORDS[LIVE.length])} things work. ${cap(WORDS[NOT_CONNECTED.length])} do not.`;
    expect(home.replace(/<!-- -->/g, '')).toContain(line);
  });

  it('links every plan card to that plan, not to the top of pricing', () => {
    expect(home).toContain('href="/pricing#plan-starter"');
    expect(home).toContain('href="/pricing#plan-professional"');
    expect(home).toContain('href="/pricing#plan-business"');
  });
});

describe('pricing', () => {
  it('does not offer a sample menu', () => {
    expect(pricing).not.toContain('/demo/menu');
  });

  it('does not put a buy button on a plan', () => {
    // The only action on the page is creating an account; no card carries a
    // "Choose" or "Buy" control, because nothing is for sale.
    expect(pricing).not.toMatch(/Choose (Starter|Professional|Business)/);
    expect(pricing).not.toMatch(/>Buy/);
  });

  it('marks every plan as not on sale', () => {
    expect(pricing.match(/Planned · not on sale/g)?.length).toBe(3);
  });

  it('counts the tier differences from the data', () => {
    expect(pricing.replace(/<!-- -->/g, '')).toContain(
      `${cap(WORDS[DIFFERENCES.length])} differences, not fifty.`,
    );
  });
});

describe('the marketing step sections', () => {
  /**
   * These two sections shipped broken: their markup used `.flow`, `.flow__step`
   * and `.flow__steps`, which are the guest ordering flow's own class names in
   * styles/guest.css. That file loads later, so on the live site the four steps
   * were drawn as progress-bar segments and their text overflowed on top of
   * itself. lib/style-scopes.test.ts guards the stylesheets; this guards the
   * markup that has to use the prefixed names.
   */
  it('never borrows the guest flow’s class names', () => {
    // The home page is Tailwind now, so the specific `pflow__` prefix that
    // replaced `.flow` here no longer exists. What still has to hold -- and is
    // the reason this test was written -- is that no marketing markup uses the
    // guest flow's own names, because styles/guest.css loads after this page
    // and used to redraw the four steps as progress-bar segments.
    for (const html of [home, pricing]) {
      expect(html).not.toContain('class="flow');
      expect(html).not.toMatch(/class="[^"]*\bflow__/);
    }
  });
});
