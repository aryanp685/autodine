import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DishPhoto } from './DishPhoto';
import { items } from '@/lib/demo-data';

/**
 * The dish photograph, and the tile that stands in for it.
 *
 * A menu column of photographs with one blank box in it reads as a broken
 * image, not as a dish the kitchen has not shot yet. These tests pin both
 * halves: that a dish with a photo renders one, and that a dish without gets
 * an honest tile rather than nothing.
 */

describe('DishPhoto', () => {
  it('draws the photograph when there is one', () => {
    const html = renderToStaticMarkup(<DishPhoto src="/img/dishes/butter-chicken.jpg" name="Butter Chicken" size={116} />);

    // next/image rewrites the src through the optimiser, so the path is
    // asserted on the value that actually reaches the browser.
    expect(decodeURIComponent(html)).toContain('/img/dishes/butter-chicken.jpg');
    expect(html).toContain('alt="Butter Chicken"');
    expect(html).not.toContain('data-dish-photo="none"');
  });

  it('draws initials on the same tile when there is not', () => {
    const html = renderToStaticMarkup(<DishPhoto src={null} name="Mango Lassi" size={56} />);

    expect(html).toContain('data-dish-photo="none"');
    expect(html).toContain('>ML<');
    // It is an image placeholder, so it says so to a screen reader rather than
    // reading out two letters.
    expect(html).toContain('Mango Lassi — no photograph yet');
    expect(html).toContain('width:56px');
  });

  it('has a photograph for every dish, except the ones on the list', () => {
    // The photo pass is running in batches. This is the list still to shoot;
    // it may only ever get shorter, and a dish that gains a photo has to be
    // removed from it here. A dish added to the menu without one fails the
    // test rather than quietly becoming the nth empty tile.
    // Every dish on the sample menu now has a photograph. The fallback tile
    // still exists for a restaurant that adds a dish without one.
    const stillToShoot: string[] = [];

    const missing = items.filter((item) => !item.img).map((item) => item.name);
    expect(missing).toEqual(stillToShoot);
  });

  it('points every photograph at a file in the repository', async () => {
    const { existsSync } = await import('node:fs');
    const bad = items
      .filter((item) => item.img)
      .map((item) => item.img as string)
      .filter((src) => !src.startsWith('/img/') || !existsSync(`public${src}`));

    expect(bad).toEqual([]);
  });

  it('uses one photograph per dish, not a shared stand-in', () => {
    const seen = new Map<string, string>();
    for (const item of items) {
      if (!item.img) continue;
      const other = seen.get(item.img);
      // A reused photo is how "Chicken Malai Tikka" ended up showing a picture
      // of butter chicken.
      expect(other, `${item.name} shares a photo with ${other}`).toBeUndefined();
      seen.set(item.img, item.name);
    }
  });
});
