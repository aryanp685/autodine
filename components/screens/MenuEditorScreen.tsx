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
  chipClass,
  Field,
  inputClass,
  selectClass,
  textareaClass,
  Tag,
  Empty,
  SwitchTrack,
  TableWrap,
  tableClass,
  Th,
  Td,
  Tr,
} from '@/components/owner/chrome';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { ConfirmSubmit } from '@/components/owner/ConfirmSubmit';
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
  query,
  show,
  sort,
}: {
  data?: MenuEditorData | null;
  /** Which outlet is open, for the switcher in the bar. */
  outlet?: OutletBar | null;
  selectedId?: string;
  error?: string;
  notice?: string;
  /** Serialised UndoItem from the delete that just happened, if any. */
  undo?: string;
  /** Name search from `?q=`. */
  query?: string;
  /** `all` | `available` | `soldout` from `?show=`. */
  show?: string;
  /** `menu` | `name` | `price-asc` | `price-desc` from `?sort=`. */
  sort?: string;
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

  /**
   * The compact fields that sit inside a dish panel.
   *
   * These used to be derived from the kit with `.replace('h-10', 'h-8')`, and
   * when the kit moved to `h-11` that string stopped matching: the replace
   * became a no-op and every one of these inline fields quietly grew back to
   * 44px inside a 13-inch panel. Deriving from `h-11` keeps the intent — a
   * small field is the `sm` action height, 36px — while staying a single
   * geometry rather than a second one invented per panel.
   */
  const inputSm = (extra = '') => `${inputClass.replace('h-11', 'h-9')} ${extra}`.trim();
  const selectSm = (extra = '') => `${selectClass.replace('h-11', 'h-9')} ${extra}`.trim();

  const menuName =
    data?.menus.find((m) => m.id === data.menuId)?.name ?? (live ? 'This menu' : 'Main menu');
  const itemCount = tableRows.filter((i) => (live ? true : i.category === 'curries')).length;

  /*
   * FINDING A DISH.
   *
   * The table is the whole menu and only grows. There was no way to narrow it,
   * so at sixty dishes "is the paneer sold out?" meant scrolling and reading.
   * This is a plain GET form: it works before hydration, it survives a reload,
   * and the state lives in the URL where the back button can undo it.
   *
   * Every value is re-derived from the URL on the server, so a hand-typed
   * `?show=anything` falls back to showing everything rather than to an empty
   * table that looks like a broken menu.
   */
  const q = (query ?? '').trim();
  const showFilter = show === 'available' || show === 'soldout' ? show : 'all';
  const sortOrder =
    sort === 'name' || sort === 'price-asc' || sort === 'price-desc' ? sort : 'menu';
  const filtered = tableRows.length > 5;
  const rows = (() => {
    const base = tableRows.filter((i) => (live ? true : i.category === 'curries'));
    if (!live || !filtered) return base;
    const needle = q.toLowerCase();
    const narrowed = base.filter((i) => {
      if (needle && !i.name.toLowerCase().includes(needle)) return false;
      if (showFilter === 'available') return Boolean(i.available);
      if (showFilter === 'soldout') return !i.available;
      return true;
    });
    if (sortOrder === 'menu') return narrowed;
    const byName = [...narrowed].sort((a, b) => a.name.localeCompare(b.name));
    if (sortOrder === 'name') return byName;
    const byPrice = [...narrowed].sort((a, b) => a.price - b.price);
    return sortOrder === 'price-asc' ? byPrice : byPrice.reverse();
  })();
  const narrowActive = Boolean(q) || showFilter !== 'all' || sortOrder !== 'menu';

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
          /* The menu's published state is in the meta line under the title
             ("Live to guests" / "Draft"). It used to be printed there AND as a
             tag here AND as a badge on the chip below -- three times in one
             viewport, which is two times too many. */
          <BtnLink href="/dashboard/menus/import" tone="ghost" size="sm">
            Import a menu
          </BtnLink>
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
                    className={`${chipClass(current)} gap-1.5`}
                  >
                    {menu.name}
                    {/* Only on the menus you are NOT looking at. The open
                        menu's state is the page subtitle two lines above, and
                        printing it twice in one viewport is how "Draft" ended
                        up on screen three times. */}
                    {!menu.published && !current && (
                      <span className="rounded-full bg-paper-deep px-1.5 py-px text-[10.5px] font-semibold tracking-[0.02em] text-gink-46">
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
              {/* A labelled control, not a 32px circle with a plus in it.
                  Creating a menu is a real write; it should look like one. */}
              <SubmitButton
                aria-label="Add this menu"
                pendingLabel="Adding…"
                tone="ghost"
              >
                Add
              </SubmitButton>
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
                      <p className="m-0 text-[12.5px] leading-[1.5] text-gink-46">
                        Diners reach an item through its category. Start with the ones most
                        restaurants use — you can remove any of them.
                      </p>
                      <form action={addPresetCategoriesAction} className="mt-2.5">
                        <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                        <SubmitButton
                          pendingLabel="Adding…"
                          className="w-full"
                        >
                          Add the usual {PRESET_CATEGORIES.length} categories
                        </SubmitButton>
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
                                  className="ml-0.5 grid size-6 place-items-center rounded-full text-[13px] leading-none text-gink-46 hover:bg-gink-07 hover:text-gink"
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
                            className="inline-flex h-9 items-center rounded-[10px] border border-[color-mix(in_oklab,var(--p-accent)_42%,transparent)] bg-accent-soft px-3 text-[12.5px] font-medium text-[var(--p-accent)] transition-colors hover:border-[var(--p-accent)]"
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
                            className="inline-flex h-9 items-center rounded-[10px] border border-hair-strong bg-card px-3 text-[12.5px] font-medium text-gink-64 transition-colors hover:border-gink-28 hover:text-gink"
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
                    <SubmitButton tone="ghost" pendingLabel="Adding…">
                      Add
                    </SubmitButton>
                  </form>

                  {uncategorised > 0 && (
                    <>
                      <div className="mt-3 flex items-baseline justify-between gap-2 rounded-[9px] bg-[var(--alert)]/8 px-2.5 py-1.5">
                        <span className="text-[12.5px] font-medium text-gink">Uncategorised</span>
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
              meta={
                live
                  ? narrowActive
                    ? `${rows.length} of ${tableRows.length}`
                    : `${tableRows.length} total`
                  : 'sample'
              }
              action={
                live ? (
                  /* Two bulk writes over every dish in the menu. They used to
                     sit beside the page's real action with the same weight, and
                     the destructive one fired on a single press. "Sold out"
                     now asks; "available" does not, because there is nothing to
                     lose by putting a dish back on sale. */
                  <div className="flex flex-wrap items-center gap-1.5">
                    <form action={setAllAvailabilityAction}>
                      <ConfirmSubmit
                        tone="quiet"
                        size="sm"
                        name="available"
                        value="false"
                        question={`Mark all ${tableRows.length} dishes sold out? Guests cannot order them until you put them back.`}
                        confirmLabel="Yes, all sold out"
                        className="px-2.5"
                      >
                        Mark all sold out
                      </ConfirmSubmit>
                    </form>
                    <form action={setAllAvailabilityAction}>
                      <SubmitButton
                        tone="quiet"
                        name="available"
                        value="true"
                        pendingLabel="Marking…"
                        className="px-2.5"
                      >
                        Mark all available
                      </SubmitButton>
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
                aria-label="Add a dish"
                className="mb-3 grid grid-cols-2 items-end gap-2 rounded-[14px] border border-hair bg-card p-3 sm:grid-cols-[minmax(0,1.4fr)_92px_104px_minmax(0,1fr)_auto]"
              >
                {/* Four inputs used to sit here unlabelled, each explaining
                    itself only in a placeholder that vanishes on the first
                    keystroke. Every field now carries a visible label, so the
                    `aria-label`s that used to be the only name are gone —
                    a hidden name that disagrees with the visible one is worse
                    than no hidden name at all. */}
                <label className="col-span-2 block sm:col-span-1">
                  <span className="mb-1 block text-[11.5px] font-medium text-gink-46">Dish</span>
                  <input
                    className={`${inputClass.replace('h-11', 'h-9')}`}
                    name="name"
                    placeholder="e.g. Paneer Tikka"
                    maxLength={120}
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-gink-46">Price (₹)</span>
                  <input
                    className={`${inputClass.replace('h-11', 'h-9')} tabular-nums`}
                    name="price"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="0"
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-gink-46">Type</span>
                  <select
                    className={selectClass.replace('h-11', 'h-9')}
                    name="veg"
                    defaultValue="veg"
                  >
                    <option value="veg">Veg</option>
                    <option value="non">Non-veg</option>
                  </select>
                </label>
                <label className="col-span-2 block sm:col-span-1">
                  <span className="mb-1 block text-[11.5px] font-medium text-gink-46">Category</span>
                  <select
                    className={selectClass.replace('h-11', 'h-9')}
                    name="categoryId"
                    defaultValue={defaultCategoryId}
                  >
                    {liveCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton pendingLabel="Adding…" className="col-span-2 w-full sm:col-span-1 sm:w-auto">
                  Add dish
                </SubmitButton>
              </form>
            )}

            {live && liveCategories.length === 0 && (
              <Empty className="mb-3">
                Add a category on the left and you can start adding items here.
              </Empty>
            )}

            {live && filtered && (
              <form
                method="get"
                action="/dashboard/menus"
                aria-label="Find a dish"
                data-menu-filter
                className="mb-2.5 flex flex-wrap items-end gap-2"
              >
                {selectedId && <input type="hidden" name="item" value={selectedId} />}
                <label className="block min-w-[180px] flex-1">
                  <span className="mb-1 block text-[11.5px] font-medium text-gink-46">
                    Find a dish
                  </span>
                  <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    className={inputClass.replace('h-11', 'h-9')}
                    placeholder={`Search ${itemCount} ${itemCount === 1 ? 'dish' : 'dishes'}`}
                    aria-label="Search dishes by name"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-gink-46">Show</span>
                  <select
                    name="show"
                    defaultValue={showFilter}
                    className={selectClass.replace('h-11', 'h-9')}
                  >
                    <option value="all">All dishes</option>
                    <option value="available">Available</option>
                    <option value="soldout">Sold out</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11.5px] font-medium text-gink-46">Order</span>
                  <select
                    name="sort"
                    defaultValue={sortOrder}
                    className={selectClass.replace('h-11', 'h-9')}
                  >
                    <option value="menu">As on the menu</option>
                    <option value="name">Name, A to Z</option>
                    <option value="price-asc">Price, low to high</option>
                    <option value="price-desc">Price, high to low</option>
                  </select>
                </label>
                <button type="submit" className={btn('quiet', 'sm')}>
                  Apply
                </button>
                {narrowActive && (
                  <Link
                    href={selectedId ? `/dashboard/menus?item=${encodeURIComponent(selectedId)}` : '/dashboard/menus'}
                    className={btn('quiet', 'sm')}
                  >
                    Clear
                  </Link>
                )}
              </form>
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
                      <Th>Sizes</Th>
                      {/* The last column is this row's action, and the row
                          itself says which one is being edited. It used to be
                          headed "Status" and hold the MENU's Live/Draft badge,
                          repeated identically on every row -- a column of one
                          value, which reads as per-dish state and is not. */}
                      <Th align="right">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((i) => (
                        <Tr
                          key={i.id}
                          data-row-selected={i.id === selected.id ? 'true' : undefined}
                          className={
                            i.id === selected.id
                              ? 'bg-gink-07 shadow-[inset_2px_0_0_var(--p-accent)]'
                              : undefined
                          }
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
                                {/* A switch, drawn like a switch: a track and a
                                    knob, no border, no pill around the label.
                                    It used to be a bordered pill containing a
                                    green track -- the only control of that
                                    shape on the page. */}
                                <SubmitButton
                                  bare
                                  data-availability={i.available ? 'on' : 'off'}
                                  aria-pressed={i.available}
                                  pendingLabel="Saving…"
                                  className="group inline-flex h-9 items-center gap-2 rounded-[8px] pr-2 text-[12.5px] font-medium text-gink-64 transition-colors hover:text-gink disabled:opacity-60"
                                  title={
                                    i.available
                                      ? `Mark ${i.name} sold out`
                                      : `Put ${i.name} back on sale`
                                  }
                                >
                                  <SwitchTrack
                                    on={i.available}
                                    className="group-hover:bg-[rgba(25,20,17,0.22)]"
                                  />
                                  <span className={i.available ? 'text-gink' : ''}>
                                    {i.available ? 'Available' : 'Sold out'}
                                  </span>
                                </SubmitButton>
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
                                <span data-portion-none className="text-[12.5px] text-gink-46">
                                  One price
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
                              <span data-portion-none className="text-[12.5px] text-gink-46">
                                One price
                              </span>
                            )}
                          </Td>
                          <Td>
                            <div className="flex items-center justify-end gap-2">
                              {/* Which row the editor on the right is changing.
                                  The menu's own Live/Draft state is on the page
                                  head and on every menu chip; repeating it here
                                  told the owner nothing about the dish. */}
                              {i.id === selected.id ? <Tag tone="ink">Editing</Tag> : null}
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
                                    className="grid size-6 place-items-center rounded-full text-[13.5px] leading-none text-gink-46 transition-colors hover:bg-[var(--alert)]/8 hover:text-[var(--alert)]"
                                  >
                                    ×
                                  </button>
                                </form>
                              )}
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    {narrowActive && rows.length === 0 && (
                      <tr>
                        <Td colSpan={5} className="py-8 text-center">
                          {/* Named honestly: the menu has dishes, the filter
                              just does not match them. Saying "no dishes" here
                              would be a lie about the restaurant's own menu. */}
                          <p className="m-0 text-[13px] text-gink">
                            {itemCount === 0
                              ? 'This menu has no dishes yet.'
                              : `No dishes match this view. All ${itemCount} are still here.`}
                          </p>
                          <Link
                            href={
                              selectedId
                                ? `/dashboard/menus?item=${encodeURIComponent(selectedId)}`
                                : '/dashboard/menus'
                            }
                            className="mt-2 inline-block text-[12.5px] font-medium text-[var(--p-accent)] underline decoration-[color-mix(in_oklab,var(--p-accent)_35%,transparent)] underline-offset-2 hover:decoration-[var(--p-accent)]"
                          >
                            Clear the filter
                          </Link>
                        </Td>
                      </tr>
                    )}
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

                <SubmitButton tone="ghost" size="md" pendingLabel="Saving…" className="w-full" disabled={!live}>
                  Save draft
                </SubmitButton>
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
                              className="grid size-6 place-items-center rounded-full text-[13px] leading-none text-gink-46 hover:bg-gink-07 hover:text-gink"
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
                  <SubmitButton tone="ghost" pendingLabel="Adding…" disabled={!live}>
                    Add portion
                  </SubmitButton>
                </form>
                <p className="mt-2 text-[11.5px] leading-[1.45] text-gink-46">
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
                        <span className="text-[11.5px] text-gink-46">
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
                            className="grid size-6 place-items-center rounded-full text-[13px] leading-none text-gink-46 hover:bg-gink-07 hover:text-gink"
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
                            <span className="text-[12.5px] text-gink-64">{addon.name}</span>
                            <span className="flex items-center gap-1.5">
                              <span className="text-[12.5px] text-gink tabular-nums">
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
                                  className="grid size-6 place-items-center rounded-full text-[13px] leading-none text-gink-46 hover:bg-gink-07 hover:text-gink"
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
                        <SubmitButton tone="ghost" pendingLabel="Adding…">
                          Add choice
                        </SubmitButton>
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
                    <SubmitButton tone="ghost" pendingLabel="Adding…" disabled={!live}>
                      Add group
                    </SubmitButton>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      className={selectSm('text-[12.5px]')}
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
                      className={selectSm('text-[12.5px]')}
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
                <p className="mt-2 text-[11.5px] leading-[1.45] text-gink-46">
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
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-gink">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-[var(--p-accent)]"
                    />
                    Live — diners can see this menu
                  </span>
                  <form action={publishMenuAction}>
                    <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                    <input type="hidden" name="published" value="false" />
                    <SubmitButton tone="ghost" pendingLabel="Unpublishing…">
                      Unpublish
                    </SubmitButton>
                  </form>
                </div>
              ) : (
                <form action={publishMenuAction}>
                  <input type="hidden" name="menuId" value={data?.menuId ?? ''} />
                  <SubmitButton
                    pendingLabel="Publishing…"
                    className="w-full"
                    size="md"
                    disabled={!live}
                  >
                    Publish menu
                  </SubmitButton>
                </form>
              )}
              <p className="mt-2 text-[11.5px] leading-[1.45] text-gink-46">
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
