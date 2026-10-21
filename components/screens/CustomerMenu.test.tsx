import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerMenu } from './CustomerMenu';
import { QrProblemScreen } from './QrProblemScreen';

/**
 * The table badge.
 *
 * It used to be the hard-coded string "Table 7 · on-site verified 12:41 PM",
 * rendered for every guest at every table in every restaurant. A party at
 * table 3 was told they were at table 7, and every order reached the kitchen
 * with no table at all -- because nothing had actually been verified, the
 * badge was only ever decoration that looked like information.
 *
 * These tests exist so that cannot come back. A menu that does not know the
 * table must say nothing at all; claiming one is worse than silence.
 */

const mocks = vi.hoisted(() => ({
  cart: {
    lines: [] as { itemId: string; qty: number }[],
    count: 0,
    ready: true,
    add: () => {},
    remove: () => {},
    setQty: () => {},
    clear: () => {},
  },
}));

vi.mock('@/components/CartProvider', () => ({
  useCart: () => mocks.cart,
}));

const restaurant = {
  slug: 'maddi',
  name: 'Maddi',
  tagline: 'Wood-fired',
  address: 'Nagpur',
  phone: '000',
  gstin: '',
  fssai: '',
  currency: 'INR',
  openHours: '11am to 11pm',
  timezone: 'Asia/Kolkata',
};

const data = (table?: { label: string } | null) => ({
  restaurant,
  categories: [{ id: 'c1', name: 'Main Course', count: 1 }],
  items: [
    {
      id: 'i1',
      name: 'Butter Chicken',
      desc: 'Slow-cooked in a tomato gravy',
      price: 469,
      category: 'c1',
      veg: false,
      available: true,
    },
  ],
  table,
});

function render(table?: { label: string } | null) {
  return renderToStaticMarkup(<CustomerMenu data={data(table)} />);
}

describe('the table badge', () => {
  it('says nothing about a table when none is known', () => {
    const html = render(null);
    expect(html).not.toContain('Table');
    expect(html).not.toContain('verified');
  });

  it('does not invent a table when the data omits it', () => {
    // The shape of the original lie: a menu rendered without a table still
    // announced one.
    const html = renderToStaticMarkup(<CustomerMenu data={data()} />);
    expect(html).not.toMatch(/Table\s*\d/);
  });

  it('never shows the hard-coded table it once claimed', () => {
    const html = render(null);
    expect(html).not.toContain('Table 7');
    expect(html).not.toContain('on-site verified');
  });

  it('shows the real table when one is known', () => {
    const html = render({ label: 'T4' });
    expect(html).toContain('T4');
  });

  it('shows the table it is given, not a fixed one', () => {
    // Two different tables must produce two different badges. The bug was
    // that they did not.
    expect(render({ label: 'T2' })).toContain('T2');
    expect(render({ label: 'Balcony 3' })).toContain('Balcony 3');
  });
});

describe('QrProblemScreen', () => {
  it('says what happened and what to do next', () => {
    const html = renderToStaticMarkup(
      <QrProblemScreen
        title="This code did not work"
        detail="Please ask staff for the current one."
      />
    );
    expect(html).toContain('This code did not work');
    expect(html).toContain('Please ask staff for the current one.');
  });

  it('does not show a staff hint unless there is one', () => {
    const without = renderToStaticMarkup(
      <QrProblemScreen title="Nope" detail="Try again" />
    );
    expect(without).not.toContain('taken out of service');

    const withHint = renderToStaticMarkup(
      <QrProblemScreen title="Nope" detail="Try again" staffHint="Taken out of service." />
    );
    expect(withHint).toContain('Taken out of service.');
  });
});
