import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The dish photo control, as markup.
 *
 * The interesting part is not the picker itself but what sits beside it. This
 * control used to offer a pill labelled "Replace" next to the photo the moment
 * a dish had one, and a second submit labelled "Upload" underneath it: two
 * commands that both read as "choose a different photo", one of which wrote
 * whatever was in the file input -- including nothing.
 *
 * So the rule is: one picker, and a submit that only exists once the browser
 * reports a file. That visibility is CSS (`:has()` on the form), which SSR
 * markup cannot prove; what it can prove is that the class hooks the rule
 * needs are there and that there is exactly one submit.
 */

vi.mock('@/app/(staff)/dashboard/menus/actions', () => ({
  uploadDishPhotoAction: () => {},
  removeDishPhotoAction: () => {},
}));

import { DishPhotoField } from './DishPhotoField';

const render = (over: Partial<Parameters<typeof DishPhotoField>[0]> = {}) =>
  renderToStaticMarkup(<DishPhotoField itemId="it-1" dishName="Paneer Tikka" {...over} />);

describe('DishPhotoField, one command split in two', () => {
  it('marks the form so the submit can stay hidden until a file is picked', () => {
    const html = render();

    expect(html).toContain('class="o-pick ');
    expect(html).toContain('o-pick-go');
    expect(html).toContain('type="file"');
  });

  it('says what the picker does, not what a pill used to say', () => {
    const html = render();

    expect(html).toContain('Choose a photo');
    expect(html).not.toContain('>Replace<');
  });

  it('offers the same picker, with different words, once there is a photo', () => {
    const html = render({ imageUrl: '/dishes/paneer.jpg' });

    expect(html).toContain('Choose a different photo');
    expect(html).toContain('Save photo');
    expect(html).toContain('Remove photo');
  });

  it('offers one way to save a chosen file, plus remove as its own action', () => {
    const html = render({ imageUrl: '/dishes/paneer.jpg' });
    expect(html.match(/type="submit"/g) ?? []).toHaveLength(2); // upload + remove
    expect(html.match(/Add photo|Save photo/g) ?? []).toHaveLength(1);
  });

  it('keeps the picker at the same height as every other small action', () => {
    const html = render();
    expect(html).toContain('h-9');
    expect(html).not.toContain('h-[38px]');
  });
});
