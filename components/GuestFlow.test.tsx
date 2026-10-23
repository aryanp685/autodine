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
