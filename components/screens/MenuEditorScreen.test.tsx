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

vi.mock('@/app/(staff)/dashboard/menus/actions', () => ({
  addAddonAction: mocks.action('addAddonAction'),
  addAddonGroupAction: mocks.action('addAddonGroupAction'),
  addCategoryAction: mocks.action('addCategoryAction'),
  addItemAction: mocks.action('addItemAction'),
  addPresetCategoriesAction: mocks.action('addPresetCategoriesAction'),
  addVariantAction: mocks.action('addVariantAction'),
  createMenuAction: mocks.action('createMenuAction'),
  selectMenuAction: mocks.action('selectMenuAction'),
  deleteAddonAction: mocks.action('deleteAddonAction'),
  deleteAddonGroupAction: mocks.action('deleteAddonGroupAction'),
  deleteCategoryAction: mocks.action('deleteCategoryAction'),
  deleteItemAction: mocks.action('deleteItemAction'),
  deleteVariantAction: mocks.action('deleteVariantAction'),
  publishMenuAction: mocks.action('publishMenuAction'),
  restoreItemAction: mocks.action('restoreItemAction'),
  saveItemAction: mocks.action('saveItemAction'),
  setAllAvailabilityAction: mocks.action('setAllAvailabilityAction'),
  setItemAvailabilityAction: mocks.action('setItemAvailabilityAction'),
  uploadDishPhotoAction: mocks.action('uploadDishPhotoAction'),
  removeDishPhotoAction: mocks.action('removeDishPhotoAction'),
}));

import { MenuEditorScreen } from './MenuEditorScreen';
import type { EditorItem, MenuEditorData } from '@/lib/db/menu-editor';

function data(over: Partial<MenuEditorData> = {}): MenuEditorData {
  return {
    restaurantName: 'Maddi',
    menuId: 'm-1',
    menuName: 'Main menu',
    published: false,
    menus: [{ id: 'm-1', name: 'Main menu', published: false, categoryCount: 0 }],
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
  img: null,
  sortOrder: 0,
  categoryId: 'c-1',
  spokenName: '',
  variants: [],
  addonGroups: [],
  ...over,
});

const render = (
  d: MenuEditorData | null,
  undo?: string,
  filters: { query?: string; show?: string; sort?: string } = {}
) => renderToStaticMarkup(<MenuEditorScreen data={d} undo={undo} {...filters} />);

/** Nine dishes, enough that the find bar is worth showing. */
const crowded = (over: Partial<MenuEditorData> = {}) =>
  data({
    categories: [{ id: 'c-1', name: 'Starters', itemCount: 9 }],
    items: [
      item('it-1', 'Paneer Tikka', { pricePaise: 32000 }),
      item('it-2', 'Chicken Tikka', { pricePaise: 38000, veg: false }),
      item('it-3', 'Dal Bukhara', { pricePaise: 27000 }),
      item('it-4', 'Butter Naan', { pricePaise: 6000 }),
      item('it-5', 'Masala Papad', { pricePaise: 9000, available: false }),
      item('it-6', 'Tomato Shorba', { pricePaise: 18000 }),
      item('it-7', 'Malai Kofta', { pricePaise: 34000, available: false }),
      item('it-8', 'Jeera Rice', { pricePaise: 14000 }),
      item('it-9', 'Gulab Jamun', { pricePaise: 12000 }),
    ],
    ...over,
  });

/**
 * Every table row, in order, as its own markup string.
 *
 * Searching the whole document for a dish name is a trap: the detail panel
 * beside the table also names every field it edits, so the first hit is often
 * the panel rather than the row. Rows are what the filter changes.
 */
const rowsOf = (html: string) => html.match(/<tr[\s\S]*?<\/tr>/g) ?? [];

/** The row markup for one dish, or '' when that dish is not in the table. */
const rowOf = (html: string, name: string) =>
  rowsOf(html).find((row) => row.includes(name)) ?? '';

/** The dish names as they appear down the table, top to bottom. */
const orderOf = (html: string, names: string[]) =>
  rowsOf(html)
    .map((row) => names.find((n) => row.includes(n)))
    .filter((n): n is string => Boolean(n));

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
    // Renamed from "Add item" to "Add dish" in the 2026-10-24 redesign: the
    // screen is a menu, and "item" is what the database calls it.
    expect(html).toContain('Add dish');
  });

  it('hides the add row until a category exists, since an uncategorised item is invisible', () => {
    const html = render(data());
    expect(html).toContain('Add a category on the left');
    expect(html).not.toContain('New dish name');
  });

  it('heads the sizes column with what a guest actually picks', () => {
    // Renamed from "Portions" in the 2026-10-24 redesign. A guest choosing
    // Half or Full is picking a size at one price; the detail panel still
    // talks about portions, which is the word the action names use.
    const html = render(data({ items: [item('i-1', 'Paneer Tikka')] }));

    expect(html).toContain('>Sizes<');
    expect(html).not.toContain('Variants');
  });

  it('counts the portions on each row', () => {
    const html = render(
      data({
        items: [
          item('i-1', 'Paneer Tikka', {
            variants: [
              { id: 'v-1', name: 'Half', pricePaise: 21000, sortOrder: 1 },
              { id: 'v-2', name: 'Full', pricePaise: 32000, sortOrder: 2 },
            ],
          }),
          item('i-2', 'Dal Bukhara'),
        ],
      })
    );

    // Two sizes on the first row, plain words on the one with none — an em
    // dash there read as a broken column rather than a dish sold one way.
    expect(html).toContain('data-portion-count="2"');
    expect(html).toContain('data-portion-none');
    expect(html).toContain('One price');
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
    expect(html).toContain('data-row-delete');
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

    expect(html).toContain('data-banner="undo"');
    // Two strips would read as two things having happened when one did.
    expect(html).not.toContain('data-banner="notice"');
  });

  it('shows the plain notice when there is nothing to undo', () => {
    const html = renderToStaticMarkup(<MenuEditorScreen data={data()} notice="Saved." />);

    expect(html).toContain('data-banner="notice"');
    expect(html).not.toContain('data-banner="undo"');
  });

  it('keeps the demo board when there is no data', () => {
    const html = render(null);

    expect(html).toContain('Curries &amp; Mains');
    // Escaped ONCE. The heading used to be an HTML entity inside a JS string,
    // so the ampersand was escaped twice and the board literally read
    // "Curries &amp; Mains". ``toContain('Curries &amp; Mains')`` passed
    // happily through that, because the broken string contains the fixed one.
    expect(html).not.toContain('&amp;amp;');
    // Demo rows carry real variant data, so that column is not a lie there.
    expect(html).toContain('Portions');
    // Nothing to delete: there is no database behind these rows. The editor
    // form still carries an itemId field of its own, so the check is on the
    // delete control, not on the field name.
    expect(html).not.toContain('data-row-delete');
  });
});

describe('portions', () => {
  const variant = (n: number, name: string, paise: number) => ({
    id: `v-${n}`,
    name,
    pricePaise: paise,
    sortOrder: n,
  });

  it('lists the portions with their prices, in rupees', () => {
    const html = render(
      data({
        items: [
          item('i-1', 'Paneer Tikka', {
            variants: [variant(1, 'Half', 21000), variant(2, 'Full', 32000)],
          }),
        ],
      })
    );

    expect(html).toContain('Half');
    expect(html).toContain('Full');
    // Stored in paise, shown in rupees: 21000 paise is Rs 210.
    expect(html).toContain('₹210');
    expect(html).toContain('₹320');
  });

  it('offers a remove control per portion', () => {
    // Same shape as an item delete: one small control per row, no dialog.
    const html = render(
      data({
        items: [item('i-1', 'Paneer Tikka', { variants: [variant(1, 'Half', 21000)] })],
      })
    );

    expect(html).toContain('name="variantId"');
    expect(html).toContain('data-remove-portion');
  });

  it('offers a form to add a portion, carrying the item id', () => {
    const html = render(data({ items: [item('i-1', 'Paneer Tikka')] }));

    expect(html).toContain('name="variantName"');
    expect(html).toContain('name="variantPrice"');
    expect(html).toContain('Add portion');
  });

  it('says plainly when a dish has no portions', () => {
    const html = render(data({ items: [item('i-1', 'Paneer Tikka')] }));
    expect(html).toContain('sold at one price');
  });

  it('never renders the add form as live when there is no database', () => {
    // A form that looks like it saves and cannot is worse than a control that
    // plainly does nothing.
    const html = render(null);
    expect(html).toContain('Add portion');
    expect(html).toContain('disabled');
  });
});

describe('spoken name', () => {
  it('shows the exact Devanagari the kitchen board will say', () => {
    const html = renderToStaticMarkup(
      <MenuEditorScreen data={data({ items: [item('i-1', 'Butter Chicken')] })} selectedId="i-1" />,
    );

    expect(html).toContain('Spoken name');
    // The preview is the sentence the voice gets, not a promise about it.
    expect(html).toContain('बटर चिकन');
  });

  it('uses the saved pronunciation when the restaurant has set one', () => {
    const html = renderToStaticMarkup(
      <MenuEditorScreen
        data={data({
          items: [item('i-1', 'Bhaji', { spokenName: 'भज्जी' })],
        })}
        selectedId="i-1"
      />,
    );

    expect(html).toContain('भज्जी');
  });

  it('names the words it had to guess, so they can be fixed', () => {
    const html = renderToStaticMarkup(
      <MenuEditorScreen data={data({ items: [item('i-1', 'Shawarma')] })} selectedId="i-1" />,
    );

    expect(html).toContain('Guessed, not known');
    expect(html).toContain('Shawarma');
  });

  it('says nothing needs checking when every word is known', () => {
    const html = renderToStaticMarkup(
      <MenuEditorScreen data={data({ items: [item('i-1', 'Paneer Tikka')] })} selectedId="i-1" />,
    );

    expect(html).toContain('Every word is known');
  });
});

/**
 * Add-ons in the editor.
 *
 * The point of the section is that the number typed here is the number a guest
 * pays, so the tests are about what the owner can see and act on: a price that
 * is shown, a zero that reads as free rather than as missing, and a way to add
 * a choice without leaving the dish.
 */
describe('MenuEditorScreen add-ons', () => {
  const withAddons = item('i-1', 'Butter Naan', {
    addonGroups: [
      {
        id: 'g-1',
        name: 'Add a little extra',
        minSelect: 0,
        maxSelect: 2,
        sortOrder: 0,
        addons: [
          { id: 'a-1', name: 'Extra cheese', pricePaise: 4000, available: true, sortOrder: 0 },
          { id: 'a-2', name: 'Jain', pricePaise: 0, available: true, sortOrder: 1 },
        ],
      },
    ],
  });

  const html = renderToStaticMarkup(
    <MenuEditorScreen data={data({ items: [withAddons] })} selectedId="i-1" />,
  );

  it('shows the group, so the owner can see what a diner will be offered', () => {
    expect(html).toContain('Add a little extra');
    expect(html).toContain('Choose up to 2');
    expect(html).toContain('optional');
  });

  it('shows what each choice adds to the bill', () => {
    expect(html).toContain('Extra cheese');
    expect(html).toContain('₹40');
  });

  it('calls a free add-on free, not blank', () => {
    // "Jain" costs nothing and still has to reach the kitchen. An empty price
    // cell would read as a number that failed to load.
    expect(html).toContain('Jain');
    expect(html).toContain('Free');
  });

  it('offers a form to add a choice to the group without leaving the dish', () => {
    expect(html).toContain('Add choice');
    expect(html).toContain('name="groupName"');
  });

  it('says a dish has no add-ons rather than showing an empty section', () => {
    const bare = renderToStaticMarkup(
      <MenuEditorScreen data={data({ items: [item('i-2', 'Masala Dosa')] })} selectedId="i-2" />,
    );

    expect(bare).toContain('No add-ons');
  });
});

describe('MenuEditorScreen menu tabs', () => {
  it('draws one real tab per menu, with the draft ones marked', () => {
    const html = renderToStaticMarkup(
      <MenuEditorScreen
        data={data({
          menus: [
            { id: 'm-1', name: 'Breakfast', published: true, categoryCount: 2 },
            { id: 'm-2', name: 'Dinner', published: false, categoryCount: 0 },
          ],
          menuId: 'm-2',
          menuName: 'Dinner',
        })}
      />,
    );

    // The tab bar used to be three decorative spans that did nothing. If it
    // ever goes back to being decoration these will not be submit buttons.
    expect(html).toContain('Breakfast');
    expect(html).toContain('Dinner');
    expect(html).toContain('data-menu-tab=');
    expect(html).toContain('Draft');
    // A real form carrying the id, so switching actually switches.
    expect(html).toContain('name="menuId" value="m-1"');
  });

  it('offers a way to add a menu, and says where the new one goes', () => {
    const html = renderToStaticMarkup(<MenuEditorScreen data={data()} />);
    expect(html).toContain('New menu');
    expect(html).toContain('aria-label="Add this menu"');
  });

  it('does not offer a menu control when there is no database to write to', () => {
    // Demo mode: the form cannot save. A button that looks like it creates a
    // menu and cannot is worse than no button.
    const html = renderToStaticMarkup(<MenuEditorScreen />);
    expect(html).toContain('Main menu');
    expect(html).not.toContain('aria-label="Add this menu"');
  });
});

/**
 * The item table used to carry a "Status" column holding the MENU's Live/Draft
 * badge, printed identically on every row. A column of one value reads as
 * per-dish state and is not: a dish is live because the menu is. What the table
 * actually needs to say is which row the editor on the right is holding open.
 */
describe('the item table', () => {
  it('marks the row being edited instead of repeating the menu badge', () => {
    const html = render(
      data({
        categories: [{ id: 'c-1', name: 'Starters', itemCount: 1 }],
        items: [item('it-1', 'Paneer Tikka')],
      }),
    );

    expect(html).toContain('Editing');
    expect(html).toContain('data-row-selected="true"');
    // The menu's own state stays on the page head, not in a column of rows.
    expect(html).not.toContain('>Status</th>');
  });

  it('keeps the delete control in the row it belongs to', () => {
    const html = render(
      data({
        categories: [{ id: 'c-1', name: 'Starters', itemCount: 1 }],
        items: [item('it-1', 'Paneer Tikka')],
      }),
    );
    expect(html).toContain('data-menu-items');
    expect(html).toContain('aria-label="Delete');
  });
});

describe('MenuEditorScreen, finding a dish in a menu that grows', () => {
  it('leaves a short menu alone', () => {
    // Four rows need no filter, and a search box over four rows is furniture.
    const html = render(
      data({
        categories: [{ id: 'c-1', name: 'Starters', itemCount: 2 }],
        items: [item('a', 'Paneer Tikka'), item('b', 'Dal Bukhara')],
      })
    );
    expect(html).not.toContain('data-menu-filter');
  });

  it('offers a find bar once the table is long enough to need one', () => {
    const html = render(crowded());

    expect(html).toContain('data-menu-filter');
    expect(html).toContain('name="q"');
    expect(html).toContain('name="show"');
    expect(html).toContain('name="sort"');
    // A GET form: it must work before hydration and survive a reload.
    expect(html).toContain('method="get"');
  });

  it('narrows to the dish being searched for', () => {
    const html = render(crowded(), undefined, { query: 'tik' });

    expect(rowOf(html, 'Paneer Tikka')).not.toBe('');
    expect(rowOf(html, 'Chicken Tikka')).not.toBe('');
    expect(rowOf(html, 'Dal Bukhara')).toBe('');
    expect(rowOf(html, 'Gulab Jamun')).toBe('');
  });

  it('ignores case, because nobody types it', () => {
    const html = render(crowded(), undefined, { query: 'GULAB' });
    expect(rowOf(html, 'Gulab Jamun')).not.toBe('');
  });

  it('shows only what is sold out when asked', () => {
    const html = render(crowded(), undefined, { show: 'soldout' });

    expect(rowOf(html, 'Masala Papad')).not.toBe('');
    expect(rowOf(html, 'Malai Kofta')).not.toBe('');
    expect(rowOf(html, 'Paneer Tikka')).toBe('');
  });

  it('shows only what is on sale when asked', () => {
    const html = render(crowded(), undefined, { show: 'available' });

    expect(rowOf(html, 'Paneer Tikka')).not.toBe('');
    expect(rowOf(html, 'Masala Papad')).toBe('');
  });

  it('orders by price, and reverses it', () => {
    const names = ['Butter Naan', 'Masala Papad', 'Paneer Tikka', 'Chicken Tikka'];
    const low = orderOf(render(crowded(), undefined, { sort: 'price-asc' }), names);
    const high = orderOf(render(crowded(), undefined, { sort: 'price-desc' }), names);

    expect(low).toEqual(['Butter Naan', 'Masala Papad', 'Paneer Tikka', 'Chicken Tikka']);
    expect(high).toEqual(['Chicken Tikka', 'Paneer Tikka', 'Masala Papad', 'Butter Naan']);
  });

  it('orders by name', () => {
    const names = ['Butter Naan', 'Chicken Tikka', 'Dal Bukhara'];
    expect(orderOf(render(crowded(), undefined, { sort: 'name' }), names)).toEqual(names);
  });

  it('keeps every dish on screen for a filter value it does not recognise', () => {
    // A hand-edited URL must not produce an empty table that reads as an
    // empty menu.
    const html = render(crowded(), undefined, { show: 'veg-only' });
    expect(rowOf(html, 'Paneer Tikka')).not.toBe('');
    expect(rowOf(html, 'Gulab Jamun')).not.toBe('');
  });

  it('says the dishes still exist when a search finds none', () => {
    const html = render(crowded(), undefined, { query: 'sushi' });

    expect(html).toContain('No dishes match this view. All 9 are still here.');
    expect(html).toContain('Clear the filter');
  });

  it('offers a clear control only while something is narrowed', () => {
    // Two different clears, for two different situations: the bar offers one
    // as soon as anything is narrowed, and the empty table offers its own.
    expect(render(crowded())).not.toContain('>Clear<');
    expect(render(crowded(), undefined, { query: 'dal' })).toContain('>Clear<');
  });
});

describe('MenuEditorScreen, the bulk writes', () => {
  const bulk = (html: string) => {
    const start = html.indexOf('Mark all sold out');
    const from = html.lastIndexOf('<button', start);
    const to = html.indexOf('</form>', start);
    return html.slice(from, to);
  };

  it('asks before marking the whole menu sold out', () => {
    const html = render(crowded());
    const control = bulk(html);

    // Armed by a click, not fired by it: the first press is a plain button,
    // and the write only happens from the confirm the press reveals.
    expect(control).toContain('type="button"');
    expect(control).not.toContain('type="submit"');
    expect(html).not.toContain('Yes, all sold out');
  });

  it('puts dishes back on sale in one press, because nothing is lost', () => {
    const html = render(crowded());
    const start = html.indexOf('Mark all available');
    const from = html.lastIndexOf('<button', start);
    expect(html.slice(from, start)).toContain('type="submit"');
  });
});
