import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductTour } from './ProductTour';

/**
 * The product tour's arithmetic.
 *
 * WHAT THIS GUARDS
 *
 * The three panels are one order at three moments: the guest's cart, the
 * kitchen's ticket, the counter's bill. They used to disagree with each other
 * -- a cart bar reading "2 items · ₹776" above a ticket of six dishes totalling
 * ₹1,247, beside a bill whose two lines added up to neither. Every number was
 * individually plausible, which is exactly why nobody noticed: the section is
 * rendered markup rather than a screenshot, so it can be checked, and a
 * marketing page whose own example does not add up is the cheapest possible way
 * to lose a restaurant owner's trust.
 *
 * The order used here is the demo data's A-1042: one Butter Chicken (₹469),
 * two Butter Naan (₹79 each) and one Mango Lassi (₹149) -- ₹776 across four
 * items.
 */

const money = (text: string) => Number(text.replace(/[₹,]/g, ''));

function render() {
  return renderToStaticMarkup(<ProductTour />);
}

describe('the product tour is one order', () => {
  it('adds the counter’s lines up to the amount it asks for', () => {
    const html = render();

    const amount = money(html.match(/tour__amount tnum">₹([\d,]+)/)![1]);
    const lines = html
      .slice(html.indexOf('tour__lines'), html.indexOf('tour__methods'))
      .split('tour__linesTotal')[0];
    const lineAmounts = [...lines.matchAll(/<span class="tnum">₹([\d,]+)<\/span>/g)].map((m) =>
      money(m[1]),
    );

    expect(lineAmounts.length).toBeGreaterThan(1);
    expect(lineAmounts.reduce((sum, n) => sum + n, 0)).toBe(amount);
    // The same number is on the button that records the cash.
    expect(money(html.match(/Record cash ₹([\d,]+)/)![1])).toBe(amount);
  });

  it('shows the same total on the ticket, in the cart bar and at the counter', () => {
    const html = render();

    const ticket = money(html.match(/tour__ticketTotal tnum">₹([\d,]+)/)![1]);
    const cart = money(html.match(/items · <span class="tnum">₹([\d,]+)/)![1]);
    const counter = money(html.match(/tour__amount tnum">₹([\d,]+)/)![1]);

    expect(ticket).toBe(counter);
    expect(cart).toBe(counter);
  });

  it('counts the same number of items in the cart bar as the ticket lists', () => {
    const html = render();

    const cartCount = Number(html.match(/<strong class="tnum">(\d+)<\/strong> items/)![1]);
    const ticketCount = [...html.matchAll(/<span class="tnum">(\d+)×<\/span>/g)].reduce(
      (sum, m) => sum + Number(m[1]),
      0,
    );

    expect(ticketCount).toBeGreaterThan(0);
    expect(cartCount).toBe(ticketCount);
  });
});
