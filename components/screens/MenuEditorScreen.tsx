import Link from 'next/link';
import { categories, items as demoItems, inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import type { MenuEditorData } from '@/lib/db/menu-editor';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  addCategoryAction,
  addItemAction,
  addPresetCategoriesAction,
  deleteCategoryAction,
  publishMenuAction,
  saveItemAction,
  setAllAvailabilityAction,
} from '@/app/dashboard/menus/actions';
import { PRESET_CATEGORIES, normaliseCategoryName } from '@/lib/menu-presets';

const FLOW = ['Draft', 'Review', 'Approve', 'Publish'];

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
  selectedId,
  error,
  notice,
}: {
  data?: MenuEditorData | null;
  selectedId?: string;
  error?: string;
  notice?: string;
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
        variants: undefined as undefined,
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

  const selectedPrice = blocked
    ? 0
    : data
      ? paiseToRupees(
          (data.items.find((i) => i.id === selected.id) ?? data.items[0])?.pricePaise ?? 0
        )
      : (selected as { price: number }).price;

  const selectedDesc = blocked
    ? ''
    : data
      ? (data.items.find((i) => i.id === selected.id) ?? data.items[0])?.desc ?? ''
      : (selected as { desc: string }).desc;

  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">
          AutoDine
        </Link>
        <div className="pg__barLinks">
          <Link href="/dashboard">Overview</Link>
          <Link href="/dashboard/menus" className="is-active">
            Menus
          </Link>
          <Link href="/dashboard/tables">Tables &amp; QR</Link>
          <span>Orders</span>
          <span>Reports</span>
        </div>
        <div className="pg__barRight">
          <span className="pg__avatar">AP</span>
        </div>
      </div>

      <div className="pg__subbar">
        <div className="pg__subTabs">
          <span className="is-active">Main menu</span>
          <span> Breakfast</span>
          <span> + New menu</span>
        </div>
        <div className="pg__flow">
          {FLOW.map((f, i) => (
            <span key={f} className={`pg__flowStep ${i === 0 ? 'is-current' : ''}`}>
              {i + 1}. {f}
            </span>
          ))}
          <span className="pg__flowState">Status: {data?.published ? 'Published' : 'Draft'}</span>
        </div>
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
        {notice && (
          <div className="pg__success" role="status">
            <strong>Done.</strong>
            <p>{notice}</p>
          </div>
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
              {/* Left inert on purpose. AI extraction needs an OCR pass and a
                  mandatory owner review before anything publishes; shipping a
                  button that pretends otherwise would break the rule that the
                  owner approves every imported item. */}
              <span className="pg__importBtn" aria-disabled="true">
                Import menu with AI
              </span>
              <p className="pg__catsNote">
                Not built yet. When it is, you review every item before it publishes.
              </p>
            </div>
          </aside>

          <section className="pg__items">
            <div className="pg__itemsHead">
              <h2>{live ? 'All items' : 'Curries &amp; Mains'}</h2>
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
                  <>
                    <span className="pg__btn">Add item</span>
                    <span className="pg__btn">Reorder</span>
                    <span className="pg__btn">Bulk availability</span>
                  </>
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
                  {/* Variants are not built. The column put an em dash on
                      every live row, which reads as a feature that happens to
                      be empty rather than one that does not exist. Demo rows
                      carry real variant data, so it stays there. */}
                  {!live && <th>Variants</th>}
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
                      {!live && (
                        <td className="tnum">{i.variants ? i.variants.length : '—'}</td>
                      )}
                      <td>
                        <span className="ui-badge ui-badge--sage">
                          {data?.published ? 'Live' : 'Draft'}
                        </span>
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
