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
    expect(without).not.toContain('flow__table');
  });

  it('marks the current step, and only the current one', () => {
    const html = renderToStaticMarkup(
      <GuestFlow step="pay" venue="Maddi">
        <p>pay</p>
      </GuestFlow>,
    );

    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/flow__step is-done[^>]*>\s*<span class="flow__sr">Menu/);
    expect(html).toMatch(/flow__step is-now[^>]*aria-current="step"[^>]*>\s*<span class="flow__sr">Pay/);
    expect(html).toMatch(/flow__step is-todo[^>]*>\s*<span class="flow__sr">Placed/);
  });

  it('offers a way back only where there is somewhere to go back to', () => {
    const root = renderToStaticMarkup(
      <GuestFlow step="menu" venue="Maddi">
        <p>menu</p>
      </GuestFlow>,
    );
    expect(root).not.toContain('flow__back');

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
    expect(docked).toContain('flow--docked');
    expect(docked).toContain('flow__dock');

    const plain = renderToStaticMarkup(
      <GuestFlow step="menu" venue="Maddi">
        <p>menu</p>
      </GuestFlow>,
    );
    expect(plain).not.toContain('flow__dock');
  });

  it('has four steps, in the order a guest goes through them', () => {
    expect(GUEST_STEPS.map((step) => step.label)).toEqual(['Menu', 'Cart', 'Pay', 'Placed']);
  });
});
