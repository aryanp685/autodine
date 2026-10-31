import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CustomerMenu, ItemSheet, initialPicks } from './CustomerMenu';
import { QrProblemScreen } from './QrProblemScreen';

/* The item sheet navigates back to the menu after adding a dish, which needs
   the App Router. These tests render components in isolation, so the router is
   stubbed rather than mounted -- nothing here asserts navigation. */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

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

describe('one look for every customer', () => {
  /**
   * The same menu, at two restaurants that picked different brands.
   *
   * The flow used to be painted with `restaurants.accent`, so these two would
   * have come out in different colours -- the same product looking like two,
   * and an owner unable to tell a branding choice from a design change. Every
   * guest now gets the same UI; the restaurant's own colour lives in the data
   * and nowhere on the screen.
   */
  it('renders identical colours for two restaurants with different accents', () => {
    const green = renderToStaticMarkup(
      <CustomerMenu data={{ ...data(), restaurant: { ...restaurant, accent: 'forest' } } as never} />,
    );
    const indigo = renderToStaticMarkup(
      <CustomerMenu data={{ ...data(), restaurant: { ...restaurant, accent: 'indigo' } } as never} />,
    );

    const accentOf = (html: string) => html.match(/--p-accent:#[0-9A-Fa-f]{6}/)?.[0];
    expect(accentOf(green)).toBeTruthy();
    expect(accentOf(green)).toBe(accentOf(indigo));
  });
});

describe('menu tabs', () => {
  it('shows a tab per published menu, and links to each one', () => {
    // Two menus used to be merged into one list, with half the dishes failing
    // at checkout. The tabs are how a guest reaches the other menu at all.
    const html = renderToStaticMarkup(
      <CustomerMenu
        data={{
          ...data(),
          menus: [
            { id: 'm-1', name: 'Breakfast' },
            { id: 'm-2', name: 'Dinner' },
          ],
          menuId: 'm-2',
          menuName: 'Dinner',
        }}
      />,
    );

    expect(html).toContain('Breakfast');
    expect(html).toContain('Dinner');
    // The menu is part of the address, so a link can be shared and the back
    // button does what it says.
    expect(html).toContain('/menu?s=maddi&amp;m=m-1');
    expect(html).toContain('aria-current="page"');
  });

  it('shows no tabs for the ordinary one-menu restaurant', () => {
    const html = renderToStaticMarkup(
      <CustomerMenu data={{ ...data(), menus: [{ id: 'm-1', name: 'Main menu' }], menuId: 'm-1' }} />,
    );
    expect(html).not.toContain('menu__menus');
    expect(html).not.toContain('Main menu');
  });

  it('carries the menu into the dish link, so the sheet opens the same dish', () => {
    const html = renderToStaticMarkup(
      <CustomerMenu
        data={{
          ...data(),
          menus: [
            { id: 'm-1', name: 'Breakfast' },
            { id: 'm-2', name: 'Dinner' },
          ],
          menuId: 'm-2',
          menuName: 'Dinner',
        }}
      />,
    );
    expect(html).toContain('m=m-2');
  });
});

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

  it('wears the same gate shell as the code form and the bare menu link', () => {
    // A dead card used to land on a page with its own centred badge and its
    // own type scale -- the one screen in the flow that did not look like the
    // restaurant's product at the moment a guest is already unsure.
    const html = renderToStaticMarkup(
      <QrProblemScreen title="This code did not work" detail="Ask staff." />
    );

    expect(html).toContain('data-gnote-body');
    expect(html).toContain('data-gnote-eyebrow');
    expect(html).toContain('Table access');
    expect(html).not.toContain('pg__qrProblem');
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

/**
 * The price on the add button.
 *
 * It was wrong long before portions existed. item.price is already in rupees,
 * and the button ran it through paiseToRupees() first, dividing by a hundred:
 * a Rs 469 dish offered itself as "Add to order · Rs 5". Nobody noticed
 * because there was only one price on the screen and no second number to
 * compare it against -- the note underneath said Rs 469, but the note was in
 * small grey text under a button people press without reading.
 *
 * Once the sheet offered Half at Rs 250 and Full at Rs 469, the button read
 * Rs 3 against two visible prices in the hundreds, and became impossible to
 * miss. These tests exist so it cannot go back.
 */
describe('the add button price', () => {
  const dish = (variants?: { id: string; name: string; price: number }[]) => ({
    restaurant,
    categories: [{ id: 'c1', name: 'Main Course', count: 1 }],
    items: [
      {
        id: 'i1',
        name: 'Butter Chicken',
        desc: 'Slow-cooked',
        price: 469,
        category: 'c1',
        veg: false,
        available: true,
        ...(variants ? { variants } : {}),
      },
    ],
    table: null,
  });

  const portions = [
    { id: 'v-half', name: 'Half', price: 250 },
    { id: 'v-full', name: 'Full', price: 469 },
  ];

  const button = (html: string) => {
    const match = html.match(/Add to order · [^<]*/);
    return match ? match[0] : '';
  };

  it('shows the dish price in rupees, not divided by a hundred', () => {
    const html = renderToStaticMarkup(<ItemSheet data={dish()} />);
    expect(button(html)).toBe('Add to order · ₹469');
  });

  it('shows the cheapest portion when that is the one selected', () => {
    // The first variant is selected by default, which is the half plate.
    const html = renderToStaticMarkup(<ItemSheet data={dish(portions)} />);
    expect(button(html)).toBe('Add to order · ₹250');
  });

  it('shows the full price once the full plate is chosen', () => {
    // Rendered with the full plate first, so it is the default selection.
    const html = renderToStaticMarkup(
      <ItemSheet data={dish([portions[1], portions[0]])} />
    );
    expect(button(html)).toBe('Add to order · ₹469');
  });

  it('never shows a three-digit price as a single digit', () => {
    const html = renderToStaticMarkup(<ItemSheet data={dish(portions)} />);
    expect(button(html)).not.toBe('Add to order · ₹3');
  });
});

/**
 * Add-ons on the dish sheet.
 *
 * They used to be presets printed on every dish -- "Spice level", "Pair it
 * with / Butter naan +79" -- that never reached the kitchen and were never
 * charged, with a footnote admitting as much. These tests pin the opposite:
 * what is offered comes from the restaurant, and the price on the button
 * already includes it.
 */
/**
 * What starts ticked, which is the difference between an add-on being OFFERED
 * and an add-on being CHARGED. The rule lives in one exported function so it
 * can be pinned without rendering the sheet.
 */
describe('initialPicks', () => {
  const group = (over: {
    id: string;
    type: 'single' | 'multi';
    required?: boolean;
    options: { id: string; price: number }[];
  }) => over;

  it('preselects the free option of a required single choice', () => {
    const picks = initialPicks([
      group({
        id: 'g-size',
        type: 'single',
        required: true,
        options: [
          { id: 'a-paid', price: 30 },
          { id: 'a-free', price: 0 },
        ],
      }),
    ]);
    expect(picks).toEqual({ 'g-size': ['a-free'] });
  });

  it('never preselects anything for an optional group', () => {
    // An optional single choice with a free option used to start on it, so the
    // cart line carried an add-on the guest never picked ("+ Mild" on a dish
    // nobody customised), and a radio cannot be cleared once it is on. Optional
    // means opt-in.
    const picks = initialPicks([
      group({
        id: 'g-spice',
        type: 'single',
        options: [
          { id: 'a-mild', price: 0 },
          { id: 'a-hot', price: 0 },
        ],
      }),
      group({
        id: 'g-extra',
        type: 'multi',
        options: [{ id: 'a-cheese', price: 40 }],
      }),
    ]);
    expect(picks).toEqual({ 'g-spice': [], 'g-extra': [] });
  });

  it('waits on a required choice whose every option costs money', () => {
    const picks = initialPicks([
      group({
        id: 'g-size',
        type: 'single',
        required: true,
        options: [
          { id: 'a-half', price: 20 },
          { id: 'a-full', price: 40 },
        ],
      }),
    ]);
    expect(picks).toEqual({ 'g-size': [] });
  });
});

describe('ItemSheet add-ons', () => {
  const button = (html: string) => {
    const match = html.match(/Add to order · [^<]*/);
    return match ? match[0] : '';
  };

  const withAddons = (
    groups: {
      id: string;
      name: string;
      type: 'single' | 'multi';
      required?: boolean;
      max?: number;
      options: { id: string; name: string; price: number }[];
    }[]
  ) => ({
    restaurant,
    categories: [{ id: 'c1', name: 'Breads', count: 1 }],
    items: [
      {
        id: 'i-naan',
        name: 'Butter Naan',
        desc: 'Tandoor baked',
        price: 80,
        category: 'c1',
        veg: true,
        available: true,
        modifiers: groups,
      },
    ],
    table: null,
  });

  const extras = [
    {
      id: 'g-extra',
      name: 'Add a little extra',
      type: 'multi' as const,
      max: 2,
      options: [
        { id: 'a-cheese', name: 'Extra cheese', price: 40 },
        { id: 'a-butter', name: 'Extra butter', price: 20 },
      ],
    },
  ];

  it('offers the dish\'s own add-ons as chips, with their prices', () => {
    const html = renderToStaticMarkup(<ItemSheet data={withAddons(extras)} />);

    expect(html).toContain('Add a little extra');
    expect(html).toContain('Extra cheese');
    expect(html).toContain('+ ₹40');
    expect(html).toContain('pick up to 2');
  });

  it('adds nothing until something is picked', () => {
    const html = renderToStaticMarkup(<ItemSheet data={withAddons(extras)} />);
    expect(button(html)).toBe('Add to order · ₹80');
  });

  it('starts a required group on its FREE option, never a paid one', () => {
    // Positional pre-selection charged for something the guest never chose:
    // a menu that lists "With dal and rice +Rs 30" first added Rs 30 to the
    // plate, and the only clue was a total that had always been higher.
    const html = renderToStaticMarkup(
      <ItemSheet
        data={withAddons([
          {
            id: 'g-size',
            name: 'Make it a meal',
            type: 'single',
            required: true,
            options: [
              { id: 'a-meal', name: 'With dal and rice', price: 30 },
              { id: 'a-plain', name: 'Just the naan', price: 0 },
            ],
          },
        ])}
      />,
    );

    expect(html).toContain('required');
    expect(button(html)).toBe('Add to order · ₹80');
  });

  it('asks for a required choice instead of charging for one', () => {
    // Every option costs money, so there is no default that is not a charge.
    // The button waits, and says what it is waiting for.
    const html = renderToStaticMarkup(
      <ItemSheet
        data={withAddons([
          {
            id: 'g-size',
            name: 'Portion',
            type: 'single',
            required: true,
            options: [
              { id: 'a-half', name: 'Half', price: 20 },
              { id: 'a-full', name: 'Full', price: 40 },
            ],
          },
        ])}
      />,
    );

    // The add button in the sheet, not the checkout button: it is the one that
    // says what it is waiting for, and it is disabled until the group is
    // answered.
    expect(html).toContain('Choose portion</button>');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Choose portion/);
  });

  it('no longer offers presets for a dish the restaurant has not customised', () => {
    const html = renderToStaticMarkup(
      <ItemSheet
        data={{
          restaurant,
          categories: [{ id: 'c1', name: 'Breads', count: 1 }],
          items: [
            {
              id: 'i-plain',
              name: 'Tandoori Roti',
              desc: 'Whole wheat',
              price: 30,
              category: 'c1',
              veg: true,
              available: true,
            },
          ],
          table: null,
        }}
      />,
    );

    // The old sheet invented these for every dish and charged for none.
    expect(html).not.toContain('Spice level');
    expect(html).not.toContain('Pair it with');
    expect(button(html)).toBe('Add to order · ₹30');
  });
});

/**
 * Leaving the dish sheet.
 *
 * The close control used to be a bare /menu link, throwing away both the
 * restaurant and the menu the sheet came from. Against a configured database
 * that is not the menu at all -- it is the "open this from your table" page --
 * so customising a dish and closing the sheet was a dead end, in production
 * only, which is the worst kind of regression: invisible in the demo.
 */
describe('leaving the dish sheet', () => {
  const withMenu = (menuId: string) => ({
    restaurant,
    categories: [{ id: 'c1', name: 'Main Course', count: 1 }],
    items: [
      {
        id: 'i1',
        name: 'Butter Chicken',
        desc: 'Slow-cooked',
        price: 469,
        category: 'c1',
        veg: false,
        available: true,
        variants: [{ id: 'v-half', name: 'Half', price: 250 }],
      },
    ],
    menus: [{ id: menuId, name: 'Dinner' }],
    menuId,
    menuName: 'Dinner',
  });

  it('goes back to the menu it came from, not to a slugless /menu', () => {
    const html = renderToStaticMarkup(<ItemSheet data={withMenu('m-2')} />);

    expect(html).toContain('/menu?s=maddi&amp;m=m-2');
    // A bare /menu against a live database is the gate page, not the menu.
    expect(html).not.toMatch(/href="\/menu"/);
  });

  it('offers a scrim and Escape as ways out, not only a small ×', () => {
    const html = renderToStaticMarkup(<ItemSheet data={withMenu('m-2')} />);
    expect(html).toContain('data-sheet-scrim');
    expect(html).toContain('aria-label="Close"');
  });

  it('keeps the close control working when there is no menu id', () => {
    // Demo mode (and a one-menu restaurant) has no menu id, so the link is
    // the restaurant alone -- which still resolves to the menu.
    const html = renderToStaticMarkup(
      <ItemSheet
        data={{
          restaurant,
          categories: [{ id: 'c1', name: 'Main Course', count: 1 }],
          items: [
            {
              id: 'i1',
              name: 'Butter Chicken',
              desc: 'Slow-cooked',
              price: 469,
              category: 'c1',
              veg: false,
              available: true,
            },
          ],
        }}
      />,
    );

    expect(html).toContain('/menu?s=maddi');
  });

  it('says a dish is gone instead of opening a different one', () => {
    // A stale link used to fall through to the first dish on the menu and let
    // the guest add and pay for a plate they never chose.
    const html = renderToStaticMarkup(<ItemSheet itemId="it-does-not-exist" />);

    expect(html).toContain('That dish is not on the menu');
    expect(html).not.toContain('Add to order');
  });

  it('still opens a real dish', () => {
    const html = renderToStaticMarkup(<ItemSheet itemId="it-butter-chicken" />);

    expect(html).toContain('Butter Chicken');
    expect(html).toContain('Add to order');
    expect(html).not.toContain('not on the menu');
  });

  it('stops at the cart’s own limit instead of promising more than it adds', () => {
    // The sheet incremented without a ceiling while the cart quietly stopped
    // at 99, so the button could promise a hundred plates and store 99.
    // Butter Naan: no portions, no add-ons, so the cart line is the dish alone.
    mocks.cart.lines = [{ itemId: 'it-naan', qty: 99 }];
    mocks.cart.count = 99;
    try {
      const html = renderToStaticMarkup(<ItemSheet itemId="it-naan" />);

      expect(html).toContain('You already have 99');
      // And no price, because no plate can be added.
      expect(html).not.toContain('Add to order ·');
    } finally {
      mocks.cart.lines = [];
      mocks.cart.count = 0;
    }
  });
});

/**
 * A SCAN THAT WAS THROTTLED, SAID PLAINLY.
 *
 * The guest is at a real table with a real cart. Nothing they did was wrong and
 * nothing has failed; the restaurant's own brake has paused verification for a
 * while. The screen owes them three facts, in this order: the menu is still
 * theirs, ordering is paused, and here is what to do next.
 *
 * What it must never say is anything that implies an order exists.
 */
describe('the throttle notice', () => {
  const notice =
    'This table has been scanned unusually often in the last hour. Ordering is paused for a short while — your cart is safe. You can also order with staff.';

  it('shows the explanation above the menu, not at checkout', () => {
    const html = renderToStaticMarkup(<CustomerMenu throttleNotice={notice} />);

    expect(html).toContain('data-throttle-note');
    expect(html).toContain('Table check paused');
    expect(html).toContain('your cart is safe');
    expect(html).toContain('order with staff');
  });

  it('keeps the menu readable, because browsing was never the problem', () => {
    const html = renderToStaticMarkup(<CustomerMenu throttleNotice={notice} />);

    // The same dishes the un-throttled menu shows.
    const plain = renderToStaticMarkup(<CustomerMenu />);
    const dishNames = ['Paneer', 'Biryani', 'Naan', 'Kebab', 'Dal'];
    const shown = dishNames.filter((name) => html.includes(name));
    const expected = dishNames.filter((name) => plain.includes(name));
    expect(shown).toEqual(expected);
  });

  it('does not claim an order was placed', () => {
    const html = renderToStaticMarkup(<CustomerMenu throttleNotice={notice} />);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

    for (const lie of ['order placed', 'order confirmed', 'sent to the kitchen', 'we saved']) {
      expect(text).not.toContain(lie);
    }
  });

  it('says nothing at all on an ordinary visit', () => {
    const html = renderToStaticMarkup(<CustomerMenu />);
    expect(html).not.toContain('data-throttle-note');
    expect(html).not.toContain('Table check paused');
  });

  it('is a status region, so a screen reader hears it without an interruption', () => {
    const html = renderToStaticMarkup(<CustomerMenu throttleNotice={notice} />);
    expect(html).toMatch(/role="status"[^>]*data-throttle-note|data-throttle-note[^>]*role="status"/);
    // Not an alert: nothing has failed, the menu is still usable.
    expect(html).not.toContain('role="alert"');
  });
});
