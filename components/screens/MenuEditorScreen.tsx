import { DashboardBar } from '@/components/DashboardBar';
import type { OutletBar } from '@/lib/outlets';
import Link from 'next/link';
import { categories, items as demoItems, inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import type { MenuEditorData } from '@/lib/db/menu-editor';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  addAddonAction,
  addAddonGroupAction,
  addCategoryAction,
  addItemAction,
  addPresetCategoriesAction,
  createMenuAction,
  addVariantAction,
  deleteAddonAction,
  deleteAddonGroupAction,
  deleteCategoryAction,
  deleteItemAction,
  deleteVariantAction,
  publishMenuAction,
  restoreItemAction,
  saveItemAction,
  selectMenuAction,
  setAllAvailabilityAction,
} from '@/app/dashboard/menus/actions';
import { PRESET_CATEGORIES, normaliseCategoryName } from '@/lib/menu-presets';
import { PronunciationField } from '@/components/PronunciationField';

/**
 * Shared page structure; styled by the locked design system.
 *
 * `data` is the live menu when the database is configured. Without it the
 * screen renders its demo rows and every control stays inert, which is the
 * honest thing to do: a form that looks like it saves and does not is worse
 * than a control that plainly does nothing.
 */
export function MenuEditorScreen({
  data,
  outlet,
  selectedId,
  error,
  notice,
  undo,
}: {
  data?: MenuEditorData | null;
  /** Which outlet is open, for the switcher in the bar. */
  outlet?: OutletBar | null;
  selectedId?: string;
  error?: string;
  notice?: string;
  /** Serialised UndoItem from the delete that just happened, if any. */
  undo?: string;
}) {
  const live = Boolean(data);
  // A blocked caller has a database and no restaurant. The editor below is
  // hidden for them, so whatever this resolves to is never rendered -- it is
  // kept non-null so the form's shape and its types stay unchanged.
  const blocked = data?.blocked;
  const selected = blocked
    ? demoItems.find((i) => i.id === 'it-butter-chicken')!
    : (data?.items.find((i) => i.id === selectedId) ??
       data?.items[0] ??
       demoItems.find((i) => i.id === 'it-butter-chicken')!);

  // Demo rows are rupees; the database stores paise. Normalise to rupees for
  // the price input and the table, and convert back only on save.
  const tableRows = data
    ? data.items.map((i) => ({
        id: i.id,
        name: i.name,
        desc: i.desc,
        price: paiseToRupees(i.pricePaise),
        veg: i.veg,
        available: i.available,
        // Carried through rather than blanked. This used to be forced to
        // `undefined` because variants were not built; it is what made the
        // column land on an em dash for every live row.
        variants: i.variants.map((v) => ({
          id: v.id,
          name: v.name,
          price: paiseToRupees(v.pricePaise),
        })),
        category: i.categoryId ?? '',
      }))
    : demoItems;

  const liveCategories = data?.categories ?? [];
  const uncategorised = (data?.items ?? []).filter((i) => !i.categoryId).length;

  // The first category is the default home for a newly added item. It is the
  // only way an item can be visible to diners, so the add row is hidden until
  // one exists rather than creating something invisible.
  const defaultCategoryId = liveCategories[0]?.id ?? '';

  // Folded so a hand-typed "starters" matches the preset "Starters" instead
  // of showing a duplicate chip next to the category it already is.
  const existingByName = new Map(
    liveCategories.map((c) => [normaliseCategoryName(c.name), c] as const)
  );

  /**
   * The saved pronunciation for the selected dish, whichever source the row
   * came from. Demo rows carry none, which is also the honest answer: nothing
   * has been set for them.
   */
  const selectedSpoken = (selected as { spokenName?: string }).spokenName ?? '';

  const selectedPrice = blocked
    ? 0
    : data
      ? paiseToRupees(
          (data.items.find((i) => i.id === selected.id) ?? data.items[0])?.pricePaise ?? 0
        )
      : (selected as { price: number }).price;

  /**
   * The selected dish's portions, in rupees, whichever source it came from.
   *
   * Live rows hold paise and demo rows hold rupees, exactly as they do for the
   * price field above. Normalising here rather than at each use keeps the
   * markup identical for both, which is the same contract the rest of this
   * screen follows.
   */
  const selectedVariants: { id: string; name: string; rupees: number }[] = blocked
    ? []
    : data
      ? // Looked up from data.items rather than read off `selected`, because
        // `selected` is a union of EditorItem and the demo Item and only the
        // first carries pricePaise.
        (
          data.items.find((i) => i.id === selected.id)?.variants ?? []
        ).map((v) => ({ id: v.id, name: v.name, rupees: paiseToRupees(v.pricePaise) }))
      : (
          (selected as { variants?: { id: string; name: string; price: number }[] }).variants ??
          []
        ).map((v) => ({ id: v.id, name: v.name, rupees: v.price }));

  /**
   * The selected dish's add-on groups, with their options in paise.
   *
   * Demo rows carry none: the sample screen is a layout, and inventing
   * add-ons for it would put prices on screen that no till could charge.
   */
  const selectedAddonGroups = blocked
    ? []
    : (data?.items.find((i) => i.id === selected.id)?.addonGroups ?? []);

  const selectedDesc = blocked
    ? ''
    : data
      ? (data.items.find((i) => i.id === selected.id) ?? data.items[0])?.desc ?? ''
      : (selected as { desc: string }).desc;

  return (
    <div className="pg pg--dash">
      <DashboardBar active="menus" outlet={outlet} />

      <div className="pg__subbar">
        <div className="pg__subTabs">
          {/*
            These used to be three decorative spans -- "Main menu", "Breakfast",
            "+ New menu" -- none of which did anything. They were a picture of a
            feature that did not exist, on the screen where an owner would go
            looking for it. They are real now: a form per menu, and one to add
            another.
          */}
          {data && !data.blocked ? (
            <>
              {data.menus.map((menu) => (
                <form key={menu.id} action={selectMenuAction} className="pg__menuTabForm">
                  <input type="hidden" name="menuId" value={menu.id} />
                  <button
                    type="submit"
                    className={`pg__menuTab ${menu.id === data.menuId ? 'is-active' : ''}`}
                    aria-current={menu.id === data.menuId ? 'true' : undefined}
                    title={
                      menu.published
                        ? `${menu.name} — live`
                        : `${menu.name} — draft, not visible to guests`
                    }
                  >
                    {menu.name}
                    {!menu.published && <span className="pg__menuTabDraft">Draft</span>}
                  </button>
                </form>
              ))}
              <form action={createMenuAction} className="pg__menuTabForm">
                <input
                  type="text"
                  name="name"
                  className="pg__menuNew"
                  placeholder="New menu"
                  aria-label="Name for a new menu"
                  maxLength={40}
                  required
                />
                <button type="submit" className="pg__menuTab" aria-label="Add this menu">
                  +
                </button>
              </form>
            </>
          ) : (
            // No database, so nothing can be created or switched. One plain
            // label is the honest rendering of that.
            <span className="is-active">Main menu</span>
          )}
        </div>
        {/* One state, said once. This used to be a four-step strip -- Draft,
            Review, Approve, Publish -- where only the first step was ever
            current and the last three did not exist anywhere in the product:
            publishing is a single flag on the menu. A workflow drawn on a
            screen is a promise that the workflow exists. The action itself
            lives at the foot of the editor; this is the state, and it is
            read from the same field. */}
        <span
          className={`pg__menuState ${data?.published ? 'is-live' : 'is-draft'}`}
          title={
            !live
              ? 'Preview: no database is connected, so nothing here is published or saved'
              : data?.published
                ? 'Live: diners opening this menu see it now'
                : 'Draft: diners do not see this menu until you publish it'
          }
        >
          <i aria-hidden="true" />
          {!live ? 'Preview' : data?.published ? 'Live' : 'Draft'}
        </span>
      </div>

      {/* No padding class here. .pg__split carries its own (32px 48px 72px);
          wrapping it in .pg__body would add another 56px and move the layout
          the locked design fixed. This wrapper exists only to stack the
          banners above the three columns. */}
      <div>
        {data?.blocked && <SignInPrompt reason={data.blocked} screen="menu editor" />}
        {error && (
          <div className="pg__alert" role="alert">
            <strong>Could not save.</strong>
            <p>{error}</p>
          </div>
        )}
        {/* One banner, not two. A delete sets both a notice and an undo, and
            stacking a green "Done" strip above an "Undo" strip makes the page
            look like two things happened when one did. */}
        {undo ? (
          <div className="pg__undo" role="status">
            <span>{notice ?? 'Item deleted.'}</span>
            <form action={restoreItemAction}>
              <input type="hidden" name="undo" value={undo} />
              <button type="submit" className="pg__undoBtn">
                Undo
              </button>
            </form>
          </div>
        ) : (
          notice && (
            <div className="pg__success" role="status">
              <strong>Done.</strong>
              <p>{notice}</p>
            </div>
          )
        )}

        {!blocked && (
          <div className="pg__split">
            <aside className="pg__cats">
              <div className="pg__catsHead">Categories</div>

              {live ? (
                <>
                  {liveCategories.length === 0 ? (
                    <>
                      <p className="pg__catsNote">
                        Diners reach an item through its category. Start with the ones most
                        restaurants use — you can remove any of them.
                      </p>
                      <form action={addPresetCategoriesAction} className="pg__catsSeed">
                        <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                        <button type="submit" className="pg__btn pg__btn--solid">
                          Add the usual {PRESET_CATEGORIES.length} categories
                        </button>
                      </form>
                    </>
                  ) : (
                    liveCategories.map((c) => (
                      <div key={c.id} className="pg__cat">
                        <span>{c.name}</span>
                        <span className="tnum">
                          {c.itemCount}
                          {c.itemCount === 0 && (
                            <form action={deleteCategoryAction} className="pg__catDel">
                              <input type="hidden" name="categoryId" value={c.id} />
                              <button type="submit" aria-label={`Delete category ${c.name}`}>
                                ×
                              </button>
                            </form>
                          )}
                        </span>
                      </div>
                    ))
                  )}

                  {/* One control per common category, and the same control
                      removes it: present shows a tick and deletes on press,
                      absent shows a plus and adds on press. Nothing is locked,
                      nothing has to be typed, and an owner can go back and
                      forth as often as they like. Removing one that still
                      holds items is refused server-side, so toggling cannot
                      strand items where diners cannot see them. */}
                  <div className="pg__chipsLabel">Common categories</div>
                  <div className="pg__catChips">
                    {PRESET_CATEGORIES.map((name) => {
                      const match = existingByName.get(normaliseCategoryName(name));
                      return match ? (
                        <form key={name} action={deleteCategoryAction}>
                          <input type="hidden" name="categoryId" value={match.id} />
                          <button
                            type="submit"
                            className="pg__chip is-on"
                            aria-label={`Remove category ${name}`}
                          >
                            {name} ✓
                          </button>
                        </form>
                      ) : (
                        <form key={name} action={addCategoryAction}>
                          <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                          <input type="hidden" name="name" value={name} />
                          <button
                            type="submit"
                            className="pg__chip"
                            aria-label={`Add category ${name}`}
                          >
                            + {name}
                          </button>
                        </form>
                      );
                    })}
                  </div>

                  <form action={addCategoryAction} className="pg__catForm">
                    <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                    <input
                      className="ui-input"
                      name="name"
                      placeholder="Custom category"
                      aria-label="Custom category name"
                      maxLength={60}
                      required
                    />
                    <button type="submit" className="pg__btn">
                      Add
                    </button>
                  </form>

                  {uncategorised > 0 && (
                    <>
                      <div className="pg__cat">
                        <span>Uncategorised</span>
                        <span className="tnum">{uncategorised}</span>
                      </div>
                      <p className="pg__catsNote">
                        Diners cannot see {uncategorised === 1 ? 'this item' : `these ${uncategorised} items`} —
                        open each one and choose a category.
                      </p>
                    </>
                  )}
                </>
              ) : (
                categories.map((c, i) => (
                  <div key={c.id} className={`pg__cat ${i === 2 ? 'is-active' : ''}`}>
                    <span>{c.name}</span>
                    <span className="tnum">{c.count}</span>
                  </div>
                ))
              )}

            <div className="pg__catsFoot">
              {/* Real now: paste the text of an existing menu, review what was
                  read, and import it as a DRAFT. Nothing publishes without the
                  owner opening the draft and pressing publish. */}
              <Link href="/dashboard/menus/import" className="pg__importBtn">
                Import an existing menu
              </Link>
              <p className="pg__catsNote">
                Paste the text, check every dish and price, and it arrives as a draft. Nothing goes live until you
                publish it.
              </p>
            </div>
          </aside>

          <section className="pg__items">
            <div className="pg__itemsHead">
              <h2>{live ? 'All items' : 'Curries & Mains'}</h2>
              <div className="pg__itemsActions">
                {live ? (
                  <>
                    {/* Reorder is gone from here. It needed a drag-and-drop
                        interaction the locked layout does not define, and an
                        inert control in the middle of a row of working ones
                        reads as a bug rather than as "not built". */}
                    <form action={setAllAvailabilityAction}>
                      <button
                        type="submit"
                        name="available"
                        value="false"
                        className="pg__btn"
                      >
                        Mark all sold out
                      </button>
                    </form>
                    <form action={setAllAvailabilityAction}>
                      <button
                        type="submit"
                        name="available"
                        value="true"
                        className="pg__btn"
                      >
                        Mark all available
                      </button>
                    </form>
                  </>
                ) : (
                  // Preview. Three button-shaped spans used to sit here --
                  // "Add item", "Reorder", "Bulk availability" -- and none of
                  // them could be pressed, which is the exact thing this file
                  // argues against everywhere else. One sentence instead.
                  <p className="pg__fine">Connect the database to add, edit and publish.</p>
                )}
              </div>
            </div>
            {/* Adding an item used to create a blank "New item" row at zero
                rupees that then had to be reopened and retyped. Every field
                the item needs sits here instead, so one press produces a real
                row -- and a second press produces a different one, not a
                duplicate. */}
            {live && liveCategories.length > 0 && (
              <form action={addItemAction} className="pg__addRow">
                <input
                  className="ui-input"
                  name="name"
                  placeholder="Item name"
                  aria-label="New item name"
                  maxLength={120}
                  required
                />
                <input
                  className="ui-input tnum"
                  name="price"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Price"
                  aria-label="New item price in rupees"
                  required
                />
                <select
                  className="ui-select"
                  name="veg"
                  defaultValue="veg"
                  aria-label="New item food type"
                >
                  <option value="veg">Veg</option>
                  <option value="non">Non-veg</option>
                </select>
                <select
                  className="ui-select"
                  name="categoryId"
                  defaultValue={defaultCategoryId}
                  aria-label="New item category"
                >
                  {liveCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="pg__btn pg__btn--solid">
                  Add item
                </button>
              </form>
            )}

            {live && liveCategories.length === 0 && (
              <p className="pg__catsNote">
                Add a category on the left and you can start adding items here.
              </p>
            )}

            <table className="ui-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Price</th>
                  <th>Availability</th>
                  {/* Portions are real now, so the column applies to live
                      rows too. It used to be hidden when live, because an em
                      dash on every row read as a broken feature -- which it
                      was. */}
                  <th>Portions</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tableRows
                  // The demo board was locked showing one category's worth of
                  // rows. Live, that constant would match nothing -- real rows
                  // carry a category UUID -- so the filter applies to the demo
                  // only and the sample screen keeps its locked appearance.
                  .filter((i) => (live ? true : i.category === 'curries'))
                  .map((i) => (
                    <tr key={i.id} className={i.id === selected.id ? 'is-active' : undefined}>
                      <td>
                        <div className="pg__itemCell">
                          <VegMark veg={i.veg} />
                          <div>
                            {/* Selecting a row to edit it. A query parameter
                                keeps this a plain link, so it works without
                                JavaScript. */}
                            {live ? (
                              <Link href={`/dashboard/menus?item=${i.id}`}>
                                <strong>{i.name}</strong>
                              </Link>
                            ) : (
                              <strong>{i.name}</strong>
                            )}
                            <div className="pg__itemDesc">{i.desc}</div>
                          </div>
                        </div>
                      </td>
                      <td className="tnum">{inr(i.price)}</td>
                      <td>
                        <span className={`pg__toggle ${i.available ? 'is-on' : 'is-off'}`}>
                          <i /> {i.available ? 'Available' : 'Sold out'}
                        </span>
                      </td>
                      <td className="tnum">
                        {live ? (
                          i.variants && i.variants.length > 0 ? (
                            <span className="pg__variantCount">{i.variants.length}</span>
                          ) : (
                            <span className="pg__variantNone">—</span>
                          )
                        ) : i.variants ? (
                          i.variants.length
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <div className="pg__rowEnd">
                          <span className="ui-badge ui-badge--sage">
                            {data?.published ? 'Live' : 'Draft'}
                          </span>
                          {/* Deleting is immediate and reversible. A confirm
                              dialog on every press would slow down the one
                              edit a busy owner makes most, so the safeguard is
                              the undo instead of a question. Past orders are
                              unaffected: order_items keeps its own snapshot. */}
                          {live && (
                            <form action={deleteItemAction} className="pg__rowDel">
                              <input type="hidden" name="itemId" value={i.id} />
                              <button
                                type="submit"
                                aria-label={`Delete ${i.name}`}
                                title={`Delete ${i.name}`}
                              >
                                ×
                              </button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>

          <aside className="pg__editor">
            <div className="pg__editorHead">
              <h3>{selected.name}</h3>
              <span className="ui-badge ui-badge--outline">Editing draft</span>
            </div>

            <form action={saveItemAction} className="pg__editorForm">
              <input type="hidden" name="itemId" value={live ? selected.id : ''} />
              <label className="ui-field">
                <span className="ui-label">Item name</span>
                <input className="ui-input" name="name" defaultValue={selected.name} />
              </label>

              {/* The board reads this name out loud. Latin script is turned
                  into Devanagari automatically; this is where a name the
                  rules get wrong is corrected. */}
              <PronunciationField name={selected.name} spoken={selectedSpoken} disabled={!live} />
              <label className="ui-field">
                <span className="ui-label">Description</span>
                <textarea className="ui-input" name="description" rows={3} defaultValue={selectedDesc} />
              </label>
              {live && liveCategories.length > 0 && (
                <label className="ui-field">
                  <span className="ui-label">Category</span>
                  <select
                    className="ui-select"
                    name="categoryId"
                    defaultValue={
                      (selected as { categoryId?: string | null }).categoryId ??
                      defaultCategoryId
                    }
                  >
                    {liveCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="pg__fieldRow">
                <label className="ui-field">
                  <span className="ui-label">Price (₹)</span>
                  <input className="ui-input tnum" name="price" defaultValue={selectedPrice} />
                </label>
                <label className="ui-field">
                  <span className="ui-label">Food type</span>
                  <select className="ui-select" name="veg" defaultValue={selected.veg ? 'veg' : 'non'}>
                    <option value="veg">Vegetarian</option>
                    <option value="non">Non-vegetarian</option>
                  </select>
                </label>
              </div>

              <div className="pg__editorFoot">
                <button type="submit" className="pg__btn" disabled={!live}>
                  Save draft
                </button>
              </div>
            </form>

            {/*
              Portions.

              A dish sold in more than one size needs them, and until this
              existed there was no way to create one anywhere in the product:
              the customer sheet offered portions only for dishes that already
              had them, and no screen could add any. The feature was reachable
              only by writing SQL.

              Setting a portion here is what makes the sheet charge for it --
              place_public_order reads item_variants for the price, so the
              number an owner types is the number a guest pays.
            */}
            <div className="pg__variants">
              <div className="pg__variantsHead">
                <h4>Portions</h4>
                <span className="pg__fine">
                  {selectedVariants.length > 0
                    ? 'Diners pick one of these.'
                    : 'No portions — this dish is sold at one price.'}
                </span>
              </div>

              {live && selectedVariants.length > 0 && (
                <ul className="pg__variantList">
                  {selectedVariants.map((v) => (
                    <li key={v.id}>
                      <span>{v.name}</span>
                      <span className="tnum">{inr(v.rupees)}</span>
                      <form action={deleteVariantAction}>
                        <input type="hidden" name="variantId" value={v.id} />
                        <button
                          type="submit"
                          className="pg__variantX"
                          aria-label={`Remove the ${v.name} portion`}
                          title={`Remove ${v.name}`}
                        >
                          ×
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              <form action={addVariantAction} className="pg__variantForm">
                <input type="hidden" name="itemId" value={live ? selected.id : ''} />
                <label className="ui-field">
                  <span className="ui-label ui-label--sr">Portion name</span>
                  <input
                    className="ui-input"
                    name="variantName"
                    placeholder="Half"
                    maxLength={40}
                    disabled={!live}
                  />
                </label>
                <label className="ui-field">
                  <span className="ui-label ui-label--sr">Portion price</span>
                  <input
                    className="ui-input tnum"
                    name="variantPrice"
                    placeholder="₹"
                    inputMode="decimal"
                    disabled={!live}
                  />
                </label>
                <button type="submit" className="pg__btn" disabled={!live}>
                  Add portion
                </button>
              </form>
              <p className="pg__fine">
                Orders already placed keep their own record of the portion they were sold at.
              </p>
            </div>

            {/*
              Add-ons.

              The dish sheet has always shown a "Pair it with / Butter naan
              +79" group, and nothing ever reached the kitchen or the bill.
              These are the real thing: a group, the choices inside it, and
              the price each one adds to a plate. place_public_order reads
              item_addons for the amount, so the number typed here is the
              number a guest pays.

              A zero price is not a mistake -- "Jain" is an instruction the
              kitchen must see that costs nothing -- which is why the price
              box may be left empty.
            */}
            <div className="pg__variants">
              <div className="pg__variantsHead">
                <h4>Add-ons</h4>
                <span className="pg__fine">
                  {selectedAddonGroups.length > 0
                    ? 'Diners can pick these. Each price is added to the bill.'
                    : 'No add-ons — this dish is sold plain.'}
                </span>
              </div>

              {live &&
                selectedAddonGroups.map((group) => (
                  <div key={group.id} className="pg__variantGroup">
                    <div className="pg__variantGroupHead">
                      <strong>{group.name}</strong>
                      <span className="pg__fine">
                        {group.maxSelect === 1 ? 'Choose one' : `Choose up to ${group.maxSelect}`}
                        {' · '}
                        {group.minSelect > 0 ? 'required' : 'optional'}
                      </span>
                      <form action={deleteAddonGroupAction}>
                        <input type="hidden" name="groupId" value={group.id} />
                        <button
                          type="submit"
                          className="pg__variantX"
                          aria-label={`Remove the ${group.name} group`}
                          title={`Remove ${group.name}`}
                        >
                          ×
                        </button>
                      </form>
                    </div>

                    <ul className="pg__variantList">
                      {group.addons.map((addon) => (
                        <li key={addon.id}>
                          <span>{addon.name}</span>
                          <span className="tnum">
                            {addon.pricePaise > 0 ? inr(paiseToRupees(addon.pricePaise)) : 'Free'}
                          </span>
                          <form action={deleteAddonAction}>
                            <input type="hidden" name="addonId" value={addon.id} />
                            <button
                              type="submit"
                              className="pg__variantX"
                              aria-label={`Remove ${addon.name}`}
                              title={`Remove ${addon.name}`}
                            >
                              ×
                            </button>
                          </form>
                        </li>
                      ))}
                      {group.addons.length === 0 && (
                        <li>
                          <span className="pg__fine">No choices in it yet.</span>
                        </li>
                      )}
                    </ul>

                    <form action={addAddonAction} className="pg__variantForm">
                      <input type="hidden" name="groupId" value={group.id} />
                      <label className="ui-field">
                        <span className="ui-label ui-label--sr">Choice name</span>
                        <input
                          className="ui-input"
                          name="addonName"
                          placeholder="Extra cheese"
                          maxLength={40}
                          required
                        />
                      </label>
                      <label className="ui-field">
                        <span className="ui-label ui-label--sr">Price added</span>
                        <input
                          className="ui-input tnum"
                          name="addonPrice"
                          placeholder="₹ (blank = free)"
                          inputMode="decimal"
                        />
                      </label>
                      <button type="submit" className="pg__btn">
                        Add choice
                      </button>
                    </form>
                  </div>
                ))}

              <form action={addAddonGroupAction} className="pg__variantForm pg__variantForm--addon">
                <input type="hidden" name="itemId" value={live ? selected.id : ''} />
                <label className="ui-field">
                  <span className="ui-label ui-label--sr">Add-on group name</span>
                  <input
                    className="ui-input"
                    name="groupName"
                    placeholder="Add a little extra"
                    maxLength={60}
                    disabled={!live}
                  />
                </label>
                <label className="ui-field">
                  <span className="ui-label ui-label--sr">How many may be picked</span>
                  <select className="ui-select" name="maxSelect" defaultValue="1" disabled={!live}>
                    <option value="1">Pick one</option>
                    <option value="2">Up to 2</option>
                    <option value="3">Up to 3</option>
                    <option value="5">Up to 5</option>
                  </select>
                </label>
                <label className="ui-field">
                  <span className="ui-label ui-label--sr">Skippable</span>
                  <select className="ui-select" name="required" defaultValue="no" disabled={!live}>
                    <option value="no">Optional</option>
                    <option value="yes">Must pick one</option>
                  </select>
                </label>
                <button type="submit" className="pg__btn" disabled={!live}>
                  Add group
                </button>
              </form>
              <p className="pg__fine">
                The price here is what a guest pays — the kitchen ticket and the bill both carry
                the add-on by name.
              </p>
            </div>

            {/* Publishing used to run one way only. Once a menu was live the
                button read "Published" and went disabled, which reads as a
                broken control rather than as the state it was reporting. The
                state is now said outright, and it can be reversed. */}
            <div className="pg__editorFoot">
              {data?.published ? (
                <>
                  <span className="pg__liveBadge">
                    <i /> Live — diners can see this menu
                  </span>
                  <form action={publishMenuAction}>
                    <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                    <input type="hidden" name="published" value="false" />
                    <button type="submit" className="pg__btn">
                      Unpublish
                    </button>
                  </form>
                </>
              ) : (
                <form action={publishMenuAction}>
                  <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                  <button type="submit" className="pg__btn pg__btn--solid" disabled={!live}>
                    Publish menu
                  </button>
                </form>
              )}
            </div>

            <p className="pg__fine">
              Published changes never alter past orders or receipts — every order keeps its own snapshot of items,
              prices and modifiers.
              </p>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
