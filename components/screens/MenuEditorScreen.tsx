import type { OutletBar } from '@/lib/outlets';
import Link from 'next/link';
import { categories, items as demoItems, inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { paiseToRupees } from '@/lib/money';
import type { MenuEditorData } from '@/lib/db/menu-editor';
import { SignInPrompt } from '@/components/SignInPrompt';
import {
  OwnerPage,
  PageHead,
  SectionHead,
  Card,
  BtnLink,
  btn,
  Field,
  inputClass,
  selectClass,
  textareaClass,
  Tag,
  Empty,
  TableWrap,
  tableClass,
  Th,
  Td,
  Tr,
} from '@/components/owner/chrome';
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
  setItemAvailabilityAction,
} from '@/app/dashboard/menus/actions';
import { PRESET_CATEGORIES, normaliseCategoryName } from '@/lib/menu-presets';
import { PronunciationField } from '@/components/PronunciationField';
import { DishPhotoField } from '@/components/DishPhotoField';

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

  /** Kit inputs are 40px tall; the rails here run at 32px. */
  const inputSm = (extra = '') => `${inputClass.replace('h-10', 'h-8')} ${extra}`.trim();
  const selectSm = (extra = '') => `${selectClass.replace('h-10', 'h-8')} ${extra}`.trim();

  const menuName =
    data?.menus.find((m) => m.id === data.menuId)?.name ?? (live ? 'This menu' : 'Main menu');
  const itemCount = tableRows.filter((i) => (live ? true : i.category === 'curries')).length;

  return (
    <OwnerPage active="menus" outlet={outlet} wide>
      <PageHead
        kicker="Menus"
        title={menuName}
        meta={
          <>
            <span className="tabular-nums">{itemCount}</span> {itemCount === 1 ? 'dish' : 'dishes'}
            <span className="mx-2 text-gink-28">·</span>
            {!live ? 'Preview — nothing is saved' : data?.published ? 'Live to guests' : 'Draft'}
          </>
        }
        actions={
          <>
            {live && !data?.blocked ? (
              data?.published ? (
                <Tag tone="live">Live</Tag>
              ) : (
                <Tag tone="neutral">Draft</Tag>
              )
            ) : null}
            <BtnLink href="/dashboard/menus/import" tone="ghost" size="sm">
              Import a menu
            </BtnLink>
          </>
        }
      />

      {/* ------------------------------------------------------------ menu tabs
          One chip per menu, each its own form so switching works without
          JavaScript. The draft marker is part of the chip, because a menu you
          cannot see on a guest's phone is the one thing this row must say. */}
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-hair pb-4">
        {data && !data.blocked ? (
          <>
            {data.menus.map((menu) => {
              const current = menu.id === data.menuId;
              return (
                <form key={menu.id} action={selectMenuAction}>
                  <input type="hidden" name="menuId" value={menu.id} />
                  <button
                    type="submit"
                    aria-current={current ? 'true' : undefined}
                    data-menu-tab={current ? 'current' : 'other'}
                    title={
                      menu.published
                        ? `${menu.name} — live`
                        : `${menu.name} — draft, not visible to guests`
                    }
                    className={[
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gink',
                      current
                        ? 'border-gink bg-gink text-onink'
                        : 'border-hair-strong text-gink-64 hover:border-gink-28 hover:text-gink',
                    ].join(' ')}
                  >
                    {menu.name}
                    {!menu.published && (
                      <span
                        className={[
                          'rounded-full px-1.5 py-px text-[10px] font-semibold tracking-[0.02em]',
                          current ? 'bg-white/18 text-onink' : 'bg-paper-deep text-gink-46',
                        ].join(' ')}
                      >
                        Draft
                      </span>
                    )}
                  </button>
                </form>
              );
            })}
            <form action={createMenuAction} className="flex items-center gap-1.5">
              <input
                type="text"
                name="name"
                className={inputSm('w-[132px] text-[12.5px]')}
                placeholder="New menu"
                aria-label="Name for a new menu"
                maxLength={40}
                required
              />
              <button
                type="submit"
                aria-label="Add this menu"
                className={`${btn('ghost', 'sm')} w-8 px-0`}
              >
                +
              </button>
            </form>
          </>
        ) : (
          <span className="text-[12.5px] font-medium text-gink">Main menu</span>
        )}
      </div>

      {data?.blocked && <SignInPrompt reason={data.blocked} screen="menu editor" />}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-[12px] border border-[var(--alert)]/30 bg-[var(--alert)]/8 px-4 py-3"
        >
          <strong className="text-[12.5px] text-[var(--alert)]">Could not save.</strong>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-gink-64">{error}</p>
        </div>
      )}

      {/* One banner, not two. A delete sets both a notice and an undo, and
          stacking a green "Done" strip above an "Undo" strip makes the page
          look like two things happened when one did. */}
      {undo ? (
        <div
          data-banner="undo"
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-hair bg-card px-4 py-2.5"
        >
          <span className="text-[12.5px] text-gink-64">{notice ?? 'Item deleted.'}</span>
          <form action={restoreItemAction}>
            <input type="hidden" name="undo" value={undo} />
            <button type="submit" className={btn('ghost', 'sm')}>
              Undo
            </button>
          </form>
        </div>
      ) : (
        notice && (
          <div
            data-banner="notice"
            role="status"
            className="mb-4 rounded-[12px] border border-[var(--p-accent)]/25 bg-accent-soft px-4 py-2.5"
          >
            <strong className="text-[12.5px] text-gink">Done.</strong>{' '}
            <span className="text-[12.5px] text-gink-64">{notice}</span>
          </div>
        )
      )}

      {!blocked && (
        <div className="grid gap-5 xl:grid-cols-[204px_minmax(0,1fr)_330px] xl:items-start">
          {/* ------------------------------------------------- categories rail */}
          <aside aria-labelledby="menu-categories">
            <SectionHead title={<span id="menu-categories">Categories</span>} />
            <Card className="px-3 py-3">
              {live ? (
                <>
                  {liveCategories.length === 0 ? (
                    <>
                      <p className="m-0 text-[12px] leading-[1.5] text-gink-46">
                        Diners reach an item through its category. Start with the ones most
                        restaurants use — you can remove any of them.
                      </p>
                      <form action={addPresetCategoriesAction} className="mt-2.5">
                        <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                        <button type="submit" className={`${btn('solid', 'sm')} w-full`}>
                          Add the usual {PRESET_CATEGORIES.length} categories
                        </button>
                      </form>
                    </>
                  ) : (
                    <ul className="m-0 flex list-none flex-col p-0">
                      {liveCategories.map((c) => (
                        <li
                          key={c.id}
                          className="flex items-baseline justify-between gap-2 border-b border-hair py-1.5 last:border-b-0"
                        >
                          <span className="text-[12.5px] text-gink">{c.name}</span>
                          <span className="flex items-center gap-1 text-[11.5px] text-gink-46 tabular-nums">
                            {c.itemCount}
                            {c.itemCount === 0 && (
                              <form action={deleteCategoryAction}>
                                <input type="hidden" name="categoryId" value={c.id} />
                                <button
                                  type="submit"
                                  aria-label={`Delete category ${c.name}`}
                                  className="ml-0.5 grid size-5 place-items-center rounded-full text-[13px] leading-none text-gink-46 hover:bg-gink-07 hover:text-gink"
                                >
                                  ×
                                </button>
                              </form>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* One control per common category, and the same control
                      removes it: present shows a tick and deletes on press,
                      absent shows a plus and adds on press. */}
                  <div className="mt-4 mb-1.5 text-[10.5px] font-semibold tracking-[0.09em] text-gink-46 uppercase">
                    Common categories
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_CATEGORIES.map((name) => {
                      const match = existingByName.get(normaliseCategoryName(name));
                      return match ? (
                        <form key={name} action={deleteCategoryAction}>
                          <input type="hidden" name="categoryId" value={match.id} />
                          <button
                            type="submit"
                            aria-label={`Remove category ${name}`}
                            className="inline-flex h-7 items-center rounded-full border border-gink bg-gink px-2.5 text-[11.5px] font-medium text-onink transition-colors hover:bg-gink/88"
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
                            aria-label={`Add category ${name}`}
                            className="inline-flex h-7 items-center rounded-full border border-hair-strong px-2.5 text-[11.5px] font-medium text-gink-64 transition-colors hover:border-gink-28 hover:bg-gink-07 hover:text-gink"
                          >
                            + {name}
                          </button>
                        </form>
                      );
                    })}
                  </div>

                  <form action={addCategoryAction} className="mt-3 flex items-center gap-1.5">
                    <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                    <input
                      className={inputSm('text-[12.5px]')}
                      name="name"
                      placeholder="Custom category"
                      aria-label="Custom category name"
                      maxLength={60}
                      required
                    />
                    <button type="submit" className={btn('ghost', 'sm')}>
                      Add
                    </button>
                  </form>

                  {uncategorised > 0 && (
                    <>
                      <div className="mt-3 flex items-baseline justify-between gap-2 rounded-[9px] bg-[var(--alert)]/8 px-2.5 py-1.5">
                        <span className="text-[12px] font-medium text-gink">Uncategorised</span>
                        <span className="text-[11.5px] text-[var(--alert)] tabular-nums">
                          {uncategorised}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11.5px] leading-[1.45] text-gink-46">
                        Diners cannot see {uncategorised === 1 ? 'this item' : `these ${uncategorised} items`} —
                        open each one and choose a category.
                      </p>
                    </>
                  )}
                </>
              ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                  {categories.map((c, i) => (
                    <li
                      key={c.id}
                      data-category-active={i === 2 ? 'true' : undefined}
                      className={[
                        'flex items-baseline justify-between gap-2 rounded-[7px] px-2 py-1.5 text-[12.5px]',
                        i === 2 ? 'bg-gink-07 font-medium text-gink' : 'text-gink-64',
                      ].join(' ')}
                    >
                      <span>{c.name}</span>
                      <span className="text-[11.5px] text-gink-46 tabular-nums">{c.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <p className="mt-3 text-[11.5px] leading-[1.5] text-gink-46">
              Paste the text of an existing menu, check every dish and price, and it arrives as a
              draft. Nothing goes live until you publish it.
            </p>
          </aside>

          {/* ------------------------------------------------------- item table */}
          <section aria-labelledby="menu-items" className="min-w-0">
            <SectionHead
              title={<span id="menu-items">{live ? 'All items' : 'Curries & Mains'}</span>}
              meta={live ? `${tableRows.length} total` : 'sample'}
              action={
                live ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <form action={setAllAvailabilityAction}>
                      <button
                        type="submit"
                        name="available"
                        value="false"
                        className={btn('ghost', 'sm')}
                      >
                        Mark all sold out
                      </button>
                    </form>
                    <form action={setAllAvailabilityAction}>
                      <button
                        type="submit"
                        name="available"
                        value="true"
                        className={btn('ghost', 'sm')}
                      >
                        Mark all available
                      </button>
                    </form>
                  </div>
                ) : (
                  <span className="text-[11.5px] text-gink-46">
                    Connect the database to add, edit and publish.
                  </span>
                )
              }
            />

            {/* Adding an item used to create a blank "New item" row at zero
                rupees that then had to be reopened and retyped. Every field
                the item needs sits here instead. */}
            {live && liveCategories.length > 0 && (
              <form
                action={addItemAction}
                className="mb-3 grid grid-cols-2 gap-2 rounded-[12px] border border-hair bg-card p-3 sm:grid-cols-[minmax(0,1fr)_88px_96px_minmax(0,1fr)_auto] sm:items-center"
              >
                <input
                  className={`${inputClass.replace('h-10', 'h-9')} col-span-2 sm:col-span-1`}
                  name="name"
                  placeholder="Item name"
                  aria-label="New item name"
                  maxLength={120}
                  required
                />
                <input
                  className={`${inputClass.replace('h-10', 'h-9')} tabular-nums`}
                  name="price"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Price"
                  aria-label="New item price in rupees"
                  required
                />
                <select
                  className={selectClass.replace('h-10', 'h-9')}
                  name="veg"
                  defaultValue="veg"
                  aria-label="New item food type"
                >
                  <option value="veg">Veg</option>
                  <option value="non">Non-veg</option>
                </select>
                <select
                  className={selectClass.replace('h-10', 'h-9')}
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
                <button type="submit" className={`${btn('solid', 'sm')} h-9`}>
                  Add item
                </button>
              </form>
            )}

            {live && liveCategories.length === 0 && (
              <Empty className="mb-3">
                Add a category on the left and you can start adding items here.
              </Empty>
            )}

            <Card className="overflow-hidden">
              <TableWrap>
                <table className={tableClass} data-menu-items>
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      <Th align="right">Price</Th>
                      <Th>Availability</Th>
                      {/* Portions are real now, so the column applies to live
                          rows too. */}
                      <Th>Portions</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows
                      // The demo board was locked showing one category's worth
                      // of rows. Live, that constant would match nothing -- so
                      // the filter applies to the demo only.
                      .filter((i) => (live ? true : i.category === 'curries'))
                      .map((i) => (
                        <Tr
                          key={i.id}
                          data-row-selected={i.id === selected.id ? 'true' : undefined}
                          className={i.id === selected.id ? 'bg-gink-07' : undefined}
                        >
                          <Td>
                            <div className="flex items-start gap-2">
                              <span className="mt-[3px]">
                                <VegMark veg={i.veg} />
                              </span>
                              <div className="min-w-0">
                                {/* Selecting a row to edit it. A query
                                    parameter keeps this a plain link, so it
                                    works without JavaScript. */}
                                {live ? (
                                  <Link
                                    href={`/dashboard/menus?item=${i.id}`}
                                    className="text-[13px] font-medium text-gink underline-offset-2 hover:underline"
                                  >
                                    {i.name}
                                  </Link>
                                ) : (
                                  <strong className="text-[13px] font-medium text-gink">
                                    {i.name}
                                  </strong>
                                )}
                                <div className="mt-0.5 max-w-[46ch] truncate text-[11.5px] leading-[1.4] text-gink-46">
                                  {i.desc}
                                </div>
                              </div>
                            </div>
                          </Td>
                          <Td align="right">{inr(i.price)}</Td>
                          <Td>
                            {/* A real switch, one dish at a time. It used to be
                                a badge: the only way to sell out a single dish
                                was the two bulk buttons above. */}
                            {live ? (
                              <form action={setItemAvailabilityAction}>
                                <input type="hidden" name="itemId" value={i.id} />
                                <input
                                  type="hidden"
                                  name="available"
                                  value={i.available ? 'false' : 'true'}
                                />
                                <button
                                  type="submit"
                                  data-availability={i.available ? 'on' : 'off'}
                                  aria-pressed={i.available}
                                  title={
                                    i.available
                                      ? `Mark ${i.name} sold out`
                                      : `Put ${i.name} back on sale`
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-full text-[11.5px] font-medium text-gink-64 transition-colors hover:text-gink"
                                >
                                  <span
                                    aria-hidden="true"
                                    className={[
                                      'relative inline-flex h-[18px] w-[30px] items-center rounded-full transition-colors',
                                      i.available ? 'bg-[var(--p-accent)]' : 'bg-gink-28',
                                    ].join(' ')}
                                  >
                                    <span
                                      className={[
                                        'absolute size-3.5 rounded-full bg-white shadow-[0_1px_1px_rgba(0,0,0,0.12)] transition-[left]',
                                        i.available ? 'left-[13px]' : 'left-[2px]',
                                      ].join(' ')}
                                    />
                                  </span>
                                  <span className={i.available ? 'text-gink' : ''}>
                                    {i.available ? 'Available' : 'Sold out'}
                                  </span>
                                </button>
                              </form>
                            ) : (
                              <span
                                data-availability={i.available ? 'on' : 'off'}
                                className="inline-flex items-center gap-1.5 text-[11.5px] text-gink-64"
                              >
                                <span
                                  aria-hidden="true"
                                  className={[
                                    'size-1.5 rounded-full',
                                    i.available ? 'bg-[var(--p-accent)]' : 'bg-gink-28',
                                  ].join(' ')}
                                />
                                {i.available ? 'Available' : 'Sold out'}
                              </span>
                            )}
                          </Td>
                          <Td>
                            {live ? (
                              i.variants && i.variants.length > 0 ? (
                                <span
                                  data-portion-count={i.variants.length}
                                  className="text-[12.5px] text-gink tabular-nums"
                                >
                                  {i.variants.length}
                                </span>
                              ) : (
                                <span data-portion-none className="text-gink-28">
                                  —
                                </span>
                              )
                            ) : i.variants ? (
                              <span
                                data-portion-count={i.variants.length}
                                className="text-[12.5px] text-gink tabular-nums"
                              >
                                {i.variants.length}
                              </span>
                            ) : (
                              <span data-portion-none className="text-gink-28">
                                —
                              </span>
                            )}
                          </Td>
                          <Td>
                            <div className="flex items-center justify-end gap-2">
                              <Tag tone={data?.published ? 'live' : 'neutral'}>
                                {data?.published ? 'Live' : 'Draft'}
                              </Tag>
                              {/* Deleting is immediate and reversible. A confirm
                                  dialog on every press would slow down the one
                                  edit a busy owner makes most, so the safeguard
                                  is the undo instead of a question. */}
                              {live && (
                                <form action={deleteItemAction}>
                                  <input type="hidden" name="itemId" value={i.id} />
                                  <button
                                    type="submit"
                                    data-row-delete
                                    aria-label={`Delete ${i.name}`}
                                    title={`Delete ${i.name}`}
                                    className="grid size-6 place-items-center rounded-full text-[14px] leading-none text-gink-46 transition-colors hover:bg-[var(--alert)]/8 hover:text-[var(--alert)]"
                                  >
                                    ×
                                  </button>
                                </form>
                              )}
                            </div>
                          </Td>
                        </Tr>
                      ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          </section>

          {/* ---------------------------------------------------- dish editor */}
          <aside aria-labelledby="menu-editor" className="min-w-0">
            <SectionHead
              title={<span id="menu-editor">{selected.name}</span>}
              meta="Editing draft"
            />
            <Card className="px-4 py-4">
              {/* The photo is its own form on purpose: it uploads a file to
                  Storage and writes one column, while the form below saves text
                  fields. */}
              {live && (
                <DishPhotoField
                  itemId={selected.id}
                  dishName={selected.name}
                  imageUrl={data?.items.find((i) => i.id === selected.id)?.img ?? null}
                  disabled={!live}
                />
              )}

              <form action={saveItemAction} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="itemId" value={live ? selected.id : ''} />
                <Field label="Item name">
                  <input className={inputClass} name="name" defaultValue={selected.name} />
                </Field>

                {/* The board reads this name out loud. Latin script is turned
                    into Devanagari automatically; this is where a name the
                    rules get wrong is corrected. */}
                <PronunciationField
                  name={selected.name}
                  spoken={selectedSpoken}
                  disabled={!live}
                />

                <Field label="Description">
                  <textarea
                    className={textareaClass}
                    name="description"
                    rows={3}
                    defaultValue={selectedDesc}
                  />
                </Field>

                {live && liveCategories.length > 0 && (
                  <Field label="Category">
                    <select
                      className={selectClass}
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
                  </Field>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Price (₹)">
                    <input
                      className={`${inputClass} tabular-nums`}
                      name="price"
                      defaultValue={selectedPrice}
                    />
                  </Field>
                  <Field label="Food type">
                    <select
                      className={selectClass}
                      name="veg"
                      defaultValue={selected.veg ? 'veg' : 'non'}
                    >
                      <option value="veg">Vegetarian</option>
                      <option value="non">Non-vegetarian</option>
                    </select>
                  </Field>
                </div>

                <button type="submit" className={`${btn('ghost')} w-full`} disabled={!live}>
                  Save draft
                </button>
              </form>
            </Card>

            {/* ---------------------------------------------------------- portions
                A dish sold in more than one size needs them, and until this
                existed there was no way to create one anywhere in the product.

                Setting a portion here is what makes the sheet charge for it —
                place_public_order reads item_variants for the price, so the
                number an owner types is the number a guest pays. */}
            <div className="mt-5">
              <SectionHead
                title="Portions"
                meta={
                  selectedVariants.length > 0
                    ? 'Diners pick one'
                    : 'Sold at one price'
                }
              />
              <Card className="px-3.5 py-3">
                {live && selectedVariants.length > 0 && (
                  <ul className="m-0 mb-2 flex list-none flex-col p-0">
                    {selectedVariants.map((v) => (
                      <li
                        key={v.id}
                        className="flex items-baseline justify-between gap-2 border-b border-hair py-1.5 last:border-b-0"
                      >
                        <span className="text-[12.5px] text-gink">{v.name}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[12.5px] text-gink tabular-nums">
                            {inr(v.rupees)}
                          </span>
                          <form action={deleteVariantAction}>
                            <input type="hidden" name="variantId" value={v.id} />
                            <button
                              type="submit"
                              data-remove-portion
                              aria-label={`Remove the ${v.name} portion`}
                              title={`Remove ${v.name}`}
                              className="grid size-5 place-items-center rounded-full text-[13px] leading-none text-gink-46 hover:bg-gink-07 hover:text-gink"
                            >
                              ×
                            </button>
                          </form>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {selectedVariants.length === 0 && (
                  <p className="m-0 mb-2 text-[11.5px] leading-[1.45] text-gink-46">
                    No portions — this dish is sold at one price.
                  </p>
                )}

                <form action={addVariantAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="itemId" value={live ? selected.id : ''} />
                  <input
                    className={inputSm('text-[12.5px]')}
                    name="variantName"
                    placeholder="Half"
                    aria-label="Portion name"
                    maxLength={40}
                    disabled={!live}
                  />
                  <input
                    className={inputSm('w-[74px] text-[12.5px] tabular-nums')}
                    name="variantPrice"
                    placeholder="₹"
                    aria-label="Portion price"
                    inputMode="decimal"
                    disabled={!live}
                  />
                  <button type="submit" className={btn('ghost', 'sm')} disabled={!live}>
                    Add portion
                  </button>
                </form>
                <p className="mt-2 text-[11px] leading-[1.45] text-gink-46">
                  Orders already placed keep their own record of the portion they were sold at.
                </p>
              </Card>
            </div>

            {/* ----------------------------------------------------------- add-ons
                The dish sheet has always shown a "Pair it with / Butter naan
                +79" group, and nothing ever reached the kitchen or the bill.
                These are the real thing: a group, the choices inside it, and
                the price each one adds to a plate.

                A zero price is not a mistake -- "Jain" is an instruction the
                kitchen must see that costs nothing -- which is why the price
                box may be left empty. */}
            <div className="mt-5">
              <SectionHead
                title="Add-ons"
                meta={
                  selectedAddonGroups.length > 0
                    ? 'Each price is added to the bill'
                    : 'Sold plain'
                }
              />
              <Card className="px-3.5 py-3">
                {live &&
                  selectedAddonGroups.map((group) => (
                    <div key={group.id} className="mb-3 last:mb-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <strong className="text-[12.5px] font-medium text-gink">
                          {group.name}
                        </strong>
                        <span className="text-[11px] text-gink-46">
                          {group.maxSelect === 1 ? 'Choose one' : `Choose up to ${group.maxSelect}`}
                          {' · '}
                          {group.minSelect > 0 ? 'required' : 'optional'}
                        </span>
                        <form action={deleteAddonGroupAction} className="ml-auto">
                          <input type="hidden" name="groupId" value={group.id} />
                          <button
                            type="submit"
                            aria-label={`Remove the ${group.name} group`}
                            title={`Remove ${group.name}`}
                            className="grid size-5 place-items-center rounded-full text-[13px] leading-none text-gink-46 hover:bg-gink-07 hover:text-gink"
                          >
                            ×
                          </button>
                        </form>
                      </div>

                      <ul className="m-0 mt-1 flex list-none flex-col p-0">
                        {group.addons.map((addon) => (
                          <li
                            key={addon.id}
                            className="flex items-baseline justify-between gap-2 border-b border-hair py-1.5 last:border-b-0"
                          >
                            <span className="text-[12px] text-gink-64">{addon.name}</span>
                            <span className="flex items-center gap-1.5">
                              <span className="text-[12px] text-gink tabular-nums">
                                {addon.pricePaise > 0
                                  ? inr(paiseToRupees(addon.pricePaise))
                                  : 'Free'}
                              </span>
                              <form action={deleteAddonAction}>
                                <input type="hidden" name="addonId" value={addon.id} />
                                <button
                                  type="submit"
                                  aria-label={`Remove ${addon.name}`}
                                  title={`Remove ${addon.name}`}
                                  className="grid size-5 place-items-center rounded-full text-[13px] leading-none text-gink-46 hover:bg-gink-07 hover:text-gink"
                                >
                                  ×
                                </button>
                              </form>
                            </span>
                          </li>
                        ))}
                        {group.addons.length === 0 && (
                          <li className="py-1.5 text-[11.5px] text-gink-46">
                            No choices in it yet.
                          </li>
                        )}
                      </ul>

                      <form action={addAddonAction} className="mt-1.5 flex items-center gap-1.5">
                        <input type="hidden" name="groupId" value={group.id} />
                        <input
                          className={inputSm('text-[12.5px]')}
                          name="addonName"
                          placeholder="Extra cheese"
                          aria-label="Choice name"
                          maxLength={40}
                          required
                        />
                        <input
                          className={inputSm('w-[92px] text-[12.5px] tabular-nums')}
                          name="addonPrice"
                          placeholder="₹ or free"
                          aria-label="Price added"
                          inputMode="decimal"
                        />
                        <button type="submit" className={btn('ghost', 'sm')}>
                          Add choice
                        </button>
                      </form>
                    </div>
                  ))}

                {selectedAddonGroups.length === 0 && (
                  <p className="m-0 mb-2.5 text-[11.5px] leading-[1.45] text-gink-46">
                    No add-ons — this dish is sold plain.
                  </p>
                )}

                <form
                  action={addAddonGroupAction}
                  className={[
                    'flex flex-col gap-1.5',
                    selectedAddonGroups.length > 0 ? 'mt-3 border-t border-hair pt-3' : '',
                  ].join(' ')}
                >
                  <input type="hidden" name="itemId" value={live ? selected.id : ''} />
                  <div className="flex items-center gap-1.5">
                    <input
                      className={inputSm('text-[12.5px]')}
                      name="groupName"
                      placeholder="Add a little extra"
                      aria-label="Add-on group name"
                      maxLength={60}
                      disabled={!live}
                    />
                    <button type="submit" className={btn('ghost', 'sm')} disabled={!live}>
                      Add group
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      className={selectSm('text-[12px]')}
                      name="maxSelect"
                      defaultValue="1"
                      aria-label="How many may be picked"
                      disabled={!live}
                    >
                      <option value="1">Pick one</option>
                      <option value="2">Up to 2</option>
                      <option value="3">Up to 3</option>
                      <option value="5">Up to 5</option>
                    </select>
                    <select
                      className={selectSm('text-[12px]')}
                      name="required"
                      defaultValue="no"
                      aria-label="Skippable"
                      disabled={!live}
                    >
                      <option value="no">Optional</option>
                      <option value="yes">Must pick one</option>
                    </select>
                  </div>
                </form>
                <p className="mt-2 text-[11px] leading-[1.45] text-gink-46">
                  The price here is what a guest pays — the kitchen ticket and the bill both carry
                  the add-on by name.
                </p>
              </Card>
            </div>

            {/* Publishing used to run one way only. Once a menu was live the
                button read "Published" and went disabled, which reads as a
                broken control rather than as the state it was reporting. The
                state is now said outright, and it can be reversed. */}
            <div className="mt-5">
              {data?.published ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[var(--p-accent)]/25 bg-accent-soft px-3.5 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-gink">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-[var(--p-accent)]"
                    />
                    Live — diners can see this menu
                  </span>
                  <form action={publishMenuAction}>
                    <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                    <input type="hidden" name="published" value="false" />
                    <button type="submit" className={btn('ghost', 'sm')}>
                      Unpublish
                    </button>
                  </form>
                </div>
              ) : (
                <form action={publishMenuAction}>
                  <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                  <button
                    type="submit"
                    className={`${btn('solid')} w-full`}
                    disabled={!live}
                  >
                    Publish menu
                  </button>
                </form>
              )}
              <p className="mt-2 text-[11px] leading-[1.45] text-gink-46">
                Published changes never alter past orders or receipts — every order keeps its own
                snapshot of items, prices and modifiers.
              </p>
            </div>
          </aside>
        </div>
      )}
    </OwnerPage>
  );
}
