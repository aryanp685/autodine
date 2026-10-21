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
  addAddonAction: mocks.action('addAddonAction'),
  addAddonGroupAction: mocks.action('addAddonGroupAction'),
  addCategoryAction: mocks.action('addCategoryAction'),
  addItemAction: mocks.action('addItemAction'),
  addPresetCategoriesAction: mocks.action('addPresetCategoriesAction'),
  addVariantAction: mocks.action('addVariantAction'),
  deleteAddonAction: mocks.action('deleteAddonAction'),
  deleteAddonGroupAction: mocks.action('deleteAddonGroupAction'),
  deleteCategoryAction: mocks.action('deleteCategoryAction'),
  deleteItemAction: mocks.action('deleteItemAction'),
  deleteVariantAction: mocks.action('deleteVariantAction'),
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
  spokenName: '',
  variants: [],
  addonGroups: [],
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

  it('shows a Portions column, now that portions exist', () => {
    // The column used to be hidden when live: variants were not built, so it
    // put an em dash on every row, which reads as a broken feature rather
    // than an absent one. They are built, so it is shown.
    const html = render(data({ items: [item('i-1', 'Paneer Tikka')] }));

    expect(html).toContain('Portions');
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

    // Two portions on the first row, an em dash on the one with none.
    expect(html).toContain('pg__variantCount">2</span>');
    expect(html).toContain('pg__variantNone');
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
    expect(html).toContain('Portions');
    // Nothing to delete: there is no database behind these rows. The editor
    // form still carries an itemId field of its own, so the check is on the
    // delete control, not on the field name.
    expect(html).not.toContain('pg__rowDel');
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
    expect(html).toContain('pg__variantX');
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
