import Link from 'next/link';
import { categories, items as demoItems, inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import type { MenuEditorData } from '@/lib/db/menu-editor';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  addCategoryAction,
  addItemAction,
  deleteCategoryAction,
  publishMenuAction,
  saveItemAction,
  setAllAvailabilityAction,
} from '@/app/dashboard/menus/actions';

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
  // only way an item can be visible to diners, so the add button is inert
  // until one exists rather than creating something invisible.
  const defaultCategoryId = liveCategories[0]?.id ?? '';

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
                    <p className="pg__catsNote">
                      No categories yet. Diners reach an item through its category, so add one
                      before you add items.
                    </p>
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

                  <form action={addCategoryAction} className="pg__catForm">
                    <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                    <input
                      className="ui-input"
                      name="name"
                      placeholder="New category"
                      aria-label="New category name"
                      maxLength={60}
                      required
                    />
                    <button type="submit" className="pg__btn">
                      Add
                    </button>
                  </form>
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
                    {defaultCategoryId ? (
                      <form action={addItemAction}>
                        <input type="hidden" name="categoryId" value={defaultCategoryId} />
                        <button type="submit" className="pg__btn">
                          Add item
                        </button>
                      </form>
                    ) : (
                      // Inert rather than submit-and-fail: without a category
                      // the insert would be rejected server-side, and a button
                      // that looks live and then errors is worse than one that
                      // plainly needs something first.
                      <span className="pg__btn" aria-disabled="true">
                        Add item
                      </span>
                    )}
                    {/* Reorder needs a drag-and-drop interaction the locked
                        layout does not define. Left as a label, not a
                        button, so it cannot be read as working. */}
                    <span className="pg__btn" aria-disabled="true">
                      Reorder
                    </span>
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
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Price</th>
                  <th>Availability</th>
                  <th>Variants</th>
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
                      <td className="tnum">{i.variants ? i.variants.length : '—'}</td>
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

            <form action={publishMenuAction}>
              <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
              <div className="pg__editorFoot">
                <button
                  type="submit"
                  className="pg__btn pg__btn--solid"
                  disabled={!live || data?.published}
                >
                  {data?.published ? 'Published' : 'Send for review'}
                </button>
              </div>
            </form>

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
