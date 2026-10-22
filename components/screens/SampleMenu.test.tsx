import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SampleMenu } from './SampleMenu';

/**
 * The public sample menu.
 *
 * Two things matter here and neither is cosmetic. It has to show the real
 * design system on real-looking content -- that is its whole job -- and it has
 * to be incapable of taking an order, because it asks for no table and has no
 * session to order with.
 */
const html = renderToStaticMarkup(<SampleMenu />);

describe('sample menu', () => {
  it('sets every section that has dishes, with a heading and a dish count', () => {
    expect(html).toContain('Starters');
    expect(html).toContain('Tandoor &amp; Grills');
    expect(html).toContain('Beverages');
    expect(html).toMatch(/Starters[\s\S]*dishes/);
  });

  it('prints dishes and their prices', () => {
    expect(html).toContain('Paneer Tikka');
    expect(html).toContain('Butter Chicken');
    expect(html).toContain('₹349');
    expect(html).toContain('₹79');
  });

  it('offers no way to order: no add button, no dish link, no cart bar', () => {
    expect(html).not.toContain('menu__dishCta');
    expect(html).not.toContain('menu__cartBar');
    expect(html).not.toContain('/menu/item');
    expect(html).not.toMatch(/>\s*Add\s*</);
  });

  it('marks a sold-out dish rather than hiding it', () => {
    expect(html).toContain('Sold out');
    expect(html).toContain('Laal Maas');
  });

  it('says what it is: a sample, not a live menu', () => {
    expect(html).toContain('Sample menu');
    expect(html).toContain('no order can');
  });
});
