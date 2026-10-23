import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuestFlow, GUEST_STEPS } from './GuestFlow';

/**
 * The shell the whole ordering flow wears.
 *
 * Two things it must never do: claim a table it was not given, and claim a
 * step that is not the current one. The first is the bug this product shipped
 * once -- a hard-coded "Table 7" on every menu -- and the second would make the
 * four screens look like one screen with a moving label.
 */

describe('GuestFlow', () => {
  it('names the table only when a session gave one', () => {
    const withTable = renderToStaticMarkup(
      <GuestFlow step="menu" venue="Maddi" table="T4">
        <p>menu</p>
      </GuestFlow>,
    );
    expect(withTable).toContain('T4');

    const without = renderToStaticMarkup(
      <GuestFlow step="menu" venue="Maddi" table={null}>
        <p>menu</p>
      </GuestFlow>,
    );
    expect(without).not.toContain('data-flow-table');
  });

  it('marks the current step, and only the current one', () => {
    const html = renderToStaticMarkup(
      <GuestFlow step="pay" venue="Maddi">
        <p>pay</p>
      </GuestFlow>,
    );

    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    // Each segment carries its state as data, and its label as the first text
    // inside it. The state used to be an `is-done` CSS class, which meant the
    // test was asserting a stylesheet rather than the screen.
    expect(html).toMatch(/data-flow-step="done"[^>]*>\s*<span class="sr-only">Menu/);
    expect(html).toMatch(/data-flow-step="now"[^>]*aria-current="step"[^>]*>\s*<span class="sr-only">Pay/);
    expect(html).toMatch(/data-flow-step="todo"[^>]*>\s*<span class="sr-only">Placed/);
  });

  it('offers a way back only where there is somewhere to go back to', () => {
    const root = renderToStaticMarkup(
      <GuestFlow step="menu" venue="Maddi">
        <p>menu</p>
      </GuestFlow>,
    );
    expect(root).not.toContain('data-flow-back');

    const cart = renderToStaticMarkup(
      <GuestFlow step="cart" venue="Maddi" back={{ href: '/menu?s=maddi', label: 'Back to the menu' }}>
        <p>cart</p>
      </GuestFlow>,
    );
    expect(cart).toContain('href="/menu?s=maddi"');
    expect(cart).toContain('aria-label="Back to the menu"');
  });

  it('renders the dock only when the screen has an action', () => {
    const docked = renderToStaticMarkup(
      <GuestFlow step="cart" venue="Maddi" dock={<button type="button">Continue</button>}>
        <p>cart</p>
      </GuestFlow>,
    );
    expect(docked).toContain('data-flow-docked="true"');
    expect(docked).toContain('data-flow-dock');

    const plain = renderToStaticMarkup(
      <GuestFlow step="menu" venue="Maddi">
        <p>menu</p>
      </GuestFlow>,
    );
    expect(plain).not.toContain('data-flow-dock');
  });

  it('has four steps, in the order a guest goes through them', () => {
    expect(GUEST_STEPS.map((step) => step.label)).toEqual(['Menu', 'Cart', 'Pay', 'Placed']);
  });
});

/**
 * The bottom of the screen.
 *
 * This was two floating islands -- a cart bar above a tab bar, both inset from
 * the edges, each with its own blur, radius and shadow. On a phone they ate the
 * bottom quarter of the viewport and read as two notifications. They are one
 * docked shelf now, and this is the test that keeps them one: a dock that
 * escapes the shelf, or a page that forgets to reserve the shelf's height,
 * puts the last dish under the bar where nobody can tap it.
 */
describe('GuestFlow — the bottom shelf', () => {
  const dock = <span>Cart bar</span>;
  const tabs = <span>Tabs</span>;

  it('puts the dock and the tabs on one sheet', () => {
    const html = renderToStaticMarkup(
      <GuestFlow step="cart" dock={dock} tabs={tabs}>
        <p>cart</p>
      </GuestFlow>,
    );

    const shelf = html.slice(html.indexOf('data-flow-chrome="shelf"'));
    expect(shelf).toContain('Cart bar');
    expect(shelf).toContain('Tabs');
    // And the sheet is docked to the edge rather than floating above it.
    expect(html).toMatch(/data-flow-shelf=""[^>]*style="bottom:0"/);
  });

  it('draws no sheet at all when it owns neither row', () => {
    // Checkout renders its own pinned bar and passes `docked` only for the
    // padding. An empty shelf there would be a blur with nothing on it.
    const html = renderToStaticMarkup(
      <GuestFlow step="pay" docked>
        <p>pay</p>
      </GuestFlow>,
    );
    expect(html).not.toContain('data-flow-chrome="shelf"');
  });

  it('reserves room for both rows, not just one', () => {
    const both = renderToStaticMarkup(
      <GuestFlow step="cart" dock={dock} tabs={tabs}>
        <p>cart</p>
      </GuestFlow>,
    );
    const dockOnly = renderToStaticMarkup(
      <GuestFlow step="cart" dock={dock}>
        <p>cart</p>
      </GuestFlow>,
    );

    const pad = (html: string) =>
      Number(html.match(/padding-bottom:calc\((\d+)px/)?.[1] ?? '0');
    // 14 (breathing room) + 86 (dock) + 58 (tabs).
    expect(pad(both)).toBe(158);
    expect(pad(dockOnly)).toBe(100);
    expect(pad(both)).toBeGreaterThan(pad(dockOnly));
  });
});
