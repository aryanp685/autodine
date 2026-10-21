import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Renders the live editor -- the branch that needs a signed-in restaurant,
 * which a plain HTTP request in this sandbox cannot reach -- and asserts on
 * the markup the owner actually sees.
 *
 * The actions are stubbed because a 'use server' module cannot be imported
 * outside Next's build. What is under test is the markup: which controls
 * appear, what they say, and what state they report.
 */

const mocks = vi.hoisted(() => ({
  action: (name: string) => {
    const fn = () => {};
    Object.defineProperty(fn, 'name', { value: name });
    return fn;
  },
}));

vi.mock('@/app/dashboard/menus/actions', () => ({
  addCategoryAction: mocks.action('addCategoryAction'),
  addItemAction: mocks.action('addItemAction'),
  addPresetCategoriesAction: mocks.action('addPresetCategoriesAction'),
  deleteCategoryAction: mocks.action('deleteCategoryAction'),
  deleteItemAction: mocks.action('deleteItemAction'),
  publishMenuAction: mocks.action('publishMenuAction'),
  restoreItemAction: mocks.action('restoreItemAction'),
  saveItemAction: mocks.action('saveItemAction'),
  setAllAvailabilityAction: mocks.action('setAllAvailabilityAction'),
}));

import { MenuEditorScreen } from './MenuEditorScreen';
import type { EditorItem, MenuEditorData } from '@/lib/db/menu-editor';

function data(over: Partial<MenuEditorData> = {}): MenuEditorData {
  return {
    restaurantName: 'Maddi',
    menuId: 'm-1',
    published: false,
    items: [],
    categories: [],
    ...over,
  };
}

type ItemOverride = Partial<Omit<EditorItem, 'id' | 'name'>>;

const item = (id: string, name: string, over: ItemOverride = {}): EditorItem => ({
  id,
  name,
  desc: `${name} description`,
  pricePaise: 25000,
  veg: true,
  available: true,
  sortOrder: 0,
  categoryId: 'c-1',
  ...over,
});

const render = (d: MenuEditorData | null, undo?: string) =>
  renderToStaticMarkup(<MenuEditorScreen data={d} undo={undo} />);

describe('MenuEditorScreen, live', () => {
  it('offers every preset category as a chip when none exist yet', () => {
    const html = render(data());

    for (const name of ['Starters', 'Main Course', 'Breads', 'Rice &amp; Biryani', 'Beverages', 'Desserts']) {
      expect(html).toContain(`+ ${name}`);
    }
  });

  it('seeds all six in one press from an empty menu', () => {
    // The complaint this answers: getting from nothing to a first item meant
    // typing each category name by hand first.
    const html = render(data());
    expect(html).toContain('Add the usual 6 categories');
  });

  it('shows a preset as on, and offers to remove it, once it exists', () => {
    const html = render(data({ categories: [{ id: 'c-1', name: 'Starters', itemCount: 0 }] }));

    expect(html).toContain('Starters ✓');
    expect(html).toContain('Remove category Starters');
    // No longer offered as something to add.
    expect(html).not.toContain('+ Starters');
  });

  it('matches a preset against a hand-typed name instead of duplicating it', () => {
    // Live data had a category saved as lower-case "starter". Case-folding is
    // what stops the chip list offering a near-duplicate beside it.
    const html = render(data({ categories: [{ id: 'c-1', name: 'starters', itemCount: 0 }] }));

    expect(html).toContain('Starters ✓');
    expect(html).not.toContain('+ Starters');
  });

  it('puts every field for a new item on the add row', () => {
    const html = render(data({ categories: [{ id: 'c-1', name: 'Starters', itemCount: 0 }] }));

    expect(html).toContain('name="name"');
    expect(html).toContain('name="price"');
    expect(html).toContain('name="veg"');
    expect(html).toContain('name="categoryId"');
    expect(html).toContain('Add item');
  });

  it('hides the add row until a category exists, since an uncategorised item is invisible', () => {
    const html = render(data());
    expect(html).toContain('Add a category on the left');
    expect(html).not.toContain('New item name');
  });

  it('drops the Variants column, which showed an em dash because it is not built', () => {
    const html = render(data({ items: [item('i-1', 'Paneer Tikka')] }));

    expect(html).not.toContain('Variants');
  });

  it('says the menu is live and offers to take it down when published', () => {
    const html = render(data({ published: true }));

    expect(html).toContain('Live — diners can see this menu');
    expect(html).toContain('Unpublish');
    expect(html).toContain('value="false"');
    // The old build showed a disabled button reading "Published", which read
    // as broken rather than as the state it was reporting.
    expect(html).not.toContain('>Published<');
  });

  it('offers to publish a menu that is still a draft', () => {
    const html = render(data({ published: false }));

    expect(html).toContain('Publish menu');
    expect(html).not.toContain('Unpublish');
  });

  it('counts items that no category owns, which diners cannot see', () => {
    const html = render(
      data({
        categories: [{ id: 'c-1', name: 'Starters', itemCount: 1 }],
        items: [item('i-1', 'Filed'), item('i-2', 'Orphan', { categoryId: null })],
      })
    );

    expect(html).toContain('Uncategorised');
    expect(html).toContain('Diners cannot see this item');
  });

  it('puts a delete control on every live row', () => {
    const html = render(
      data({
        categories: [{ id: 'c-1', name: 'Starters', itemCount: 2 }],
        items: [item('i-1', 'Paneer Tikka'), item('i-2', 'Chicken 65')],
      })
    );

    expect(html).toContain('Delete Paneer Tikka');
    expect(html).toContain('Delete Chicken 65');
    expect(html).toContain('pg__rowDel');
    expect(html).toContain('name="itemId" value="i-1"');
  });

  it('offers an undo carrying the row back, after a delete', () => {
    const payload = JSON.stringify({
      id: '05979fc9-ad4d-482d-950f-27d3d0e1e519',
      name: 'Butter Chicken',
      description: null,
      pricePaise: 46900,
      isVeg: false,
      isAvailable: true,
      categoryId: '937a3c2a-1331-43be-9d03-ecf6e9f84165',
      sortOrder: 0,
    });

    const html = render(data(), payload);

    expect(html).toContain('Undo');
    expect(html).toContain('Butter Chicken');
    // The payload has to survive into a hidden field, or the undo cannot
    // put the row back with the same id and the same category.
    expect(html).toContain('name="undo"');
    expect(html).toContain('05979fc9-ad4d-482d-950f-27d3d0e1e519');
  });

  it('shows one banner after a delete, not a notice and an undo stacked', () => {
    const html = render(data(), JSON.stringify({ id: '05979fc9-ad4d-482d-950f-27d3d0e1e519', name: 'X', pricePaise: 0 }));

    expect(html).toContain('pg__undo');
    // Two strips would read as two things having happened when one did.
    expect(html).not.toContain('pg__success');
  });

  it('shows the plain notice when there is nothing to undo', () => {
    const html = renderToStaticMarkup(<MenuEditorScreen data={data()} notice="Saved." />);

    expect(html).toContain('pg__success');
    expect(html).not.toContain('pg__undo');
  });

  it('keeps the demo board when there is no data', () => {
    const html = render(null);

    expect(html).toContain('Curries &amp; Mains');
    // Demo rows carry real variant data, so that column is not a lie there.
    expect(html).toContain('Variants');
    // Nothing to delete: there is no database behind these rows. The editor
    // form still carries an itemId field of its own, so the check is on the
    // delete control, not on the field name.
    expect(html).not.toContain('pg__rowDel');
  });
});
