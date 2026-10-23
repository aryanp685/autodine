'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  categories as demoCategories,
  items as demoItems,
  restaurant as demoRestaurant,
  type Item,
} from '@/lib/demo-data';
import type {
  DisplayCategory,
  DisplayItem,
  DisplayModifierGroup,
  DisplayRestaurant,
} from '@/lib/db/adapt';
import { DishPhoto } from '@/components/DishPhoto';
import { GuestTabs } from '@/components/GuestTabs';
import { GuestFlow } from '@/components/GuestFlow';
import { MenuIdentity } from '@/components/MenuIdentity';
import { accentStyle } from '@/lib/branding/palette';
import { useCart } from '@/components/CartProvider';
import { priceCart } from '@/lib/cart-pricing';
import { filterDishes } from '@/lib/guest-search';
import { inr } from '@/lib/demo-data';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import { VegMark } from '@/components/ui';

/**
 * Whether this dish has anything to choose.
 *
 * Only real choices count. There used to be hard-coded "Spice level" and
 * "Pair it with" groups here for every dish, and neither reached the kitchen
 * or the bill -- the sheet even admitted, underneath, that they were not
 * charged. A dish with nothing to choose now goes straight into the cart
 * instead of opening a sheet full of controls that do nothing.
 */
const needsChoice = (i: Item) =>
  Boolean((i.variants && i.variants.length) || (i.modifiers && i.modifiers.length));

/**
 * Everything a menu screen shows, already in display units (rupees).
 *
 * Optional on purpose. The locked screens render identically with no data
 * passed -- they fall back to the demo content rather than breaking -- so
 * wiring one screen at a time is safe.
 */
/**
 * The table the guest is sitting at, when we actually know it.
 *
 * Optional, and that is the important part. It is only present when a QR was
 * scanned and its session is still live. When it is absent nothing claims the
 * guest is seated -- the badge is simply not rendered.
 *
 * It used to be a hard-coded string reading "Table 7 · on-site verified",
 * shown to everyone. A guest at table 3 was told they were at table 7, and
 * every order reached the kitchen with no table at all. Declining to guess is
 * not a downgrade from that.
 */
export type MenuScreenTable = {
  label: string;
};

export type MenuScreenData = {
  restaurant: DisplayRestaurant;
  /**
   * Every published menu, for the tab bar.
   *
   * Only present when the database was read. The demo menu has one, so the
   * demo screens show no tabs -- exactly as they did before this existed.
   */
  menus?: { id: string; name: string }[];
  /** The menu `categories` and `items` belong to. */
  menuId?: string;
  menuName?: string;
  categories: DisplayCategory[];
  items: DisplayItem[];
  table?: MenuScreenTable | null;
};

/* ============================================================================
   Editorial Minimal — locked design system customer menu
   ========================================================================== */
export function CustomerMenu({ data }: { data?: MenuScreenData } = {}) {
  const table = data?.table ?? null;
  const cart = useCart();
  const [cat, setCat] = useState('all');
  /** What the guest typed. Empty means no search is running. */
  const [query, setQuery] = useState('');
  /** Bumped on every add, so the bar re-runs its entry animation. */
  const [barPulse, setBarPulse] = useState(0);

  const addToCart = (itemId: string) => {
    cart.add(itemId);
    setBarPulse((n) => n + 1);
  };

  // Deliberately named to shadow the demo imports, so that not one line of
  // the locked JSX below had to change to accept real data.
  const restaurant = data?.restaurant ?? demoRestaurant;
  const categories = data?.categories ?? demoCategories;
  const items = data?.items ?? demoItems;

  // Priced against this menu for the bar only. It is a running hint, not the
  // amount charged: the order is priced from the database when it is placed.
  const slug = data?.restaurant.slug;
  const menus = data?.menus ?? [];
  const menuId = data?.menuId;
  const menuPrices = items.map((i) => ({
    id: i.id,
    name: i.name,
    pricePaise: rupeesToPaise(i.price),
    isVeg: i.veg,
    isAvailable: i.available,
    // Carried here so the bar counts the extras too. A running total that
    // ignored them would jump by a few hundred rupees at the cart, which
    // reads as a hidden charge rather than as the add-ons the guest picked.
    addons: (i.modifiers ?? []).flatMap((group) =>
      group.options.map((option) => ({
        id: option.id,
        name: option.name,
        pricePaise: rupeesToPaise(option.price),
        groupId: group.id,
        maxSelect: group.max ?? group.options.length,
      })),
    ),
  }));
  const barSubtotal = priceCart(cart.lines, menuPrices).subtotalPaise;
  const cartHref = slug ? `/menu/cart?s=${encodeURIComponent(slug)}` : '/menu/cart';
  /**
   * Searching looks across the whole menu, not only the course that happens to
   * be selected: a guest who types "kulfi" while looking at Starters is asking
   * a question about the restaurant, not about the course. Every word has to
   * match, so a second word narrows instead of widening.
   */
  const searching = query.trim().length > 0;
  const inCourse = cat === 'all' ? items : items.filter((i) => i.category === cat);
  const list = searching
    ? filterDishes(
        items,
        query,
        Object.fromEntries(categories.map((c) => [c.id, c.name])),
      )
    : inCourse;

  /**
   * How many of this dish are in the cart, for dishes that have nothing to
   * choose. A dish with portions or add-ons is served many ways, so "how many"
   * is a question only the sheet can answer.
   *
   * This is what turns the row's single button into a stepper once something
   * is in the order: adjusting a quantity from the menu is the most common
   * thing a guest does after the first tap, and sending them to the cart to do
   * it is a page load for a minus sign.
   */
  const plainQty = (itemId: string) =>
    cart.lines.find(
      (line) =>
        line.itemId === itemId &&
        !line.variantId &&
        (!line.addonIds || line.addonIds.length === 0),
    )?.qty ?? 0;
  const itemHref = (itemId: string) => {
    const params = new URLSearchParams({ item: itemId });
    if (data?.restaurant.slug) params.set('s', data.restaurant.slug);
    // Carried through: the sheet loads its dishes from one menu, and this is
    // that menu. Without it the sheet opens on the default menu and cannot
    // find the dish.
    if (menuId) params.set('m', menuId);
    return `/menu/item?${params.toString()}`;
  };

  return (
    <GuestFlow
      step="menu"
      /* The accent paints the whole flow, so it is applied once at the root. */
      style={accentStyle(data?.restaurant.accent)}
      venue={restaurant.name}
      table={table?.label ?? null}
      dock={
        /* The cart is the dock: it is the one action on a menu, and it has to
           stay under the thumb while a guest scrolls past thirty dishes. It is
           a single bar rather than two controls because there is one decision
           on this screen -- look, or go and pay -- and the number is the reason
           to go. */
        cart.count > 0 ? (
          <div key={barPulse} className="animate-[gbar_260ms_cubic-bezier(0.22,1,0.36,1)]">
            <Link
              href={cartHref}
              className="flex items-center gap-3 rounded-2xl bg-[var(--p-accent)] px-4 py-3.5 text-white shadow-g2 transition active:scale-[0.99]"
            >
              <span aria-live="polite" role="status" className="text-[13px] font-medium">
                <strong className="tnum font-semibold">{cart.count}</strong> item
                {cart.count === 1 ? '' : 's'} · <span className="tnum">{inr(paiseToRupees(barSubtotal))}</span> before
                taxes
              </span>
              <span className="ml-auto flex items-center gap-1.5 text-[13px] font-semibold tracking-[0.01em]">
                Review order
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </Link>
          </div>
        ) : null
      }
      tabs={<GuestTabs slug={slug} active="menu" />}
    >
      {/* The venue header. Its banner/paper state is decided by whether the
          restaurant has uploaded one -- see components/MenuIdentity.tsx. The
          badge that used to live here said "The menu" to everyone, which told
          a guest nothing they did not already know from holding a menu. */}
      <MenuIdentity
        name={restaurant.name}
        tagline={restaurant.tagline}
        address={restaurant.address}
        /* Branding comes only from the DATABASE shape. The demo fallback has
           no branding fields at all, and reading them off the union would be
           a type error that says exactly the right thing: there is nothing to
           show until a real restaurant has uploaded something. */
        logoUrl={data?.restaurant.logoUrl}
        bannerUrl={data?.restaurant.bannerUrl}
        tableLabel={table?.label ?? null}
      />

      {/*
        Which menu this is. Hidden for the ordinary one-menu restaurant, so
        nothing changes for them; shown the moment there is a second published
        menu, because a guest looking at Breakfast has no other way to reach
        Dinner. Plain links, not buttons: the menu is part of the address, so a
        guest can share or bookmark what they were looking at, and the back
        button does what it says.
      */}
      {menus.length > 1 && (
        <nav aria-label="Menus" className="scrollbar-none -mx-1 mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
          {menus.map((option) => {
            const params = new URLSearchParams({ s: slug ?? '' });
            params.set('m', option.id);
            const current = option.id === menuId;
            return (
              <a
                key={option.id}
                href={`/menu?${params.toString()}`}
                aria-current={current ? 'page' : undefined}
                className={[
                  'shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition',
                  current
                    ? 'g-primary border-transparent'
                    : 'border-hair-strong text-gink-64 hover:border-gink-28 hover:text-gink',
                ].join(' ')}
              >
                {option.name}
              </a>
            );
          })}
        </nav>
      )}

      {/* Sticky, because a guest scrolls forty dishes and then decides to look
          for one: a search box that has scrolled away is a search box that does
          not exist. It sits directly under the flow bar and the two share the
          same hairline so they read as one piece of chrome. */}
      <div className="sticky top-14 z-20 mt-4 border-y border-hair bg-paper/94 backdrop-blur-xl">
        <div className="px-4 pt-3 pb-2">
          {/* Search sits above the courses because it questions all of them. It
              is a real input, not a decorative one: typing filters the list
              below in the same frame, with no round trip -- the menu is already
              here. */}
          <div className="flex items-center gap-2 rounded-xl bg-gink-07 px-3 py-2.5" role="search">
            <svg
              className="shrink-0 text-gink-46"
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="6.2" />
              <path d="M15.6 15.6 20 20" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              className="w-full bg-transparent text-[14px] text-gink placeholder:text-gink-46 focus:outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search dishes"
              aria-label="Search dishes"
              autoComplete="off"
            />
            {searching && (
              <button
                type="button"
                className="shrink-0 rounded-full px-1.5 text-[12px] font-semibold text-[var(--p-accent)]"
                onClick={() => setQuery('')}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* The course rail steps aside while a search runs: it no longer
            filters anything, and a row of chips that does nothing is worse
            than no row. */}
        {!searching && (
          <nav aria-label="Courses" className="scrollbar-none flex gap-1.5 overflow-x-auto px-4 pb-2.5">
            <button
              type="button"
              aria-pressed={cat === 'all'}
              onClick={() => setCat('all')}
              className={[
                'shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition-colors',
                cat === 'all'
                  ? 'bg-[var(--p-accent)] text-white'
                  : 'bg-gink-07 text-gink-64 hover:text-gink',
              ].join(' ')}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={cat === c.id}
                onClick={() => setCat(c.id)}
                className={[
                  'shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition-colors',
                  cat === c.id
                    ? 'bg-[var(--p-accent)] text-white'
                    : 'bg-gink-07 text-gink-64 hover:text-gink',
                ].join(' ')}
              >
                {c.name}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="px-4 pt-5 pb-8">
        {/* What is below, named and counted. The rail above says which course
            is selected; this says it again where the dishes start, so a guest
            who scrolled past the rail still knows what they are reading. The
            count is the filtered list's own length -- never a typed number. */}
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="truncate text-[13px] font-semibold tracking-[0.09em] text-gink-46 uppercase">
            {searching
              ? `Results for “${query.trim()}”`
              : categories.find((c) => c.id === cat)?.name ?? 'The full menu'}
          </h2>
          <span className="tnum shrink-0 text-[12px] text-gink-46">
            {list.length} {list.length === 1 ? 'dish' : 'dishes'}
          </span>
        </div>

        {list.length === 0 &&
          (searching ? (
            /* A search that finds nothing says what to do, and keeps the query
               visible so the guest can see what they typed. */
            <div className="rounded-2xl border border-hair bg-card px-4 py-6 text-center">
              <p className="text-[14px] text-gink-64">No dish on this menu matches “{query.trim()}”.</p>
              <button
                type="button"
                className="mt-3 rounded-full bg-gink-07 px-3.5 py-1.5 text-[12.5px] font-semibold text-gink"
                onClick={() => setQuery('')}
              >
                Show the whole menu
              </button>
            </div>
          ) : (
            <p className="rounded-2xl border border-hair bg-card px-4 py-6 text-center text-[14px] text-gink-64">
              Nothing in this course is available right now. Try another, or ask the counter.
            </p>
          ))}

        <div className="flex flex-col gap-2.5">
          {list.map((i) => (
            /* One row per dish, in the order a hungry person reads it: what it
               is, what it costs, what is in it -- then the decision, in the
               column the eye already uses for pictures. */
            <article
              key={i.id}
              className={[
                'flex gap-3 rounded-2xl border bg-card p-3 transition-colors',
                i.available ? 'border-hair hover:border-hair-strong' : 'border-hair opacity-55',
              ].join(' ')}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1.5">
                  <VegMark veg={i.veg} />
                  <h3
                    className={[
                      'truncate text-[15.5px] font-semibold tracking-[-0.01em] text-gink',
                      i.available ? '' : 'line-through decoration-gink-28',
                    ].join(' ')}
                  >
                    {i.name}
                  </h3>
                  {i.badge && i.available && (
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-[var(--p-accent)] uppercase">
                      {i.badge}
                    </span>
                  )}
                </div>

                <div className="mt-1 flex items-baseline gap-1.5">
                  {i.variants && <span className="text-[10.5px] font-medium tracking-[0.05em] text-gink-46 uppercase">from</span>}
                  <span className="tnum text-[15px] font-semibold text-gink">{inr(i.price)}</span>
                </div>

                <p className="mt-1 line-clamp-2 text-[13px] leading-[1.45] text-gink-64">{i.desc}</p>

                {/* The action sits under the words on a phone and beside them
                    on a wide screen, but it is always in the thumb's reach
                    rather than at the end of a 300px line. */}
                <div className="mt-2.5">
                  {i.available ? (
                    needsChoice(i) ? (
                      <Link
                        href={itemHref(i.id)}
                        className="g-primary inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold"
                      >
                        Choose
                      </Link>
                    ) : plainQty(i.id) > 0 ? (
                      <div className="inline-flex items-center rounded-full border border-hair-strong">
                        <button
                          type="button"
                          onClick={() => cart.setQty(i.id, plainQty(i.id) - 1)}
                          aria-label={`One fewer ${i.name}`}
                          className="grid size-8 place-items-center rounded-full text-[15px] text-gink-80 transition hover:bg-gink-07"
                        >
                          −
                        </button>
                        <span className="tnum min-w-5 text-center text-[13px] font-semibold text-gink" aria-live="polite">
                          {plainQty(i.id)}
                        </span>
                        <button
                          type="button"
                          onClick={() => addToCart(i.id)}
                          aria-label={`One more ${i.name}`}
                          className="grid size-8 place-items-center rounded-full text-[15px] text-gink-80 transition hover:bg-gink-07"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addToCart(i.id)}
                        aria-label={`Add ${i.name}`}
                        className="g-primary inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold"
                      >
                        Add
                      </button>
                    )
                  ) : (
                    <span className="text-[12px] font-medium tracking-[0.03em] text-gink-46 uppercase">Sold out</span>
                  )}
                </div>
              </div>

              {/* Every dish gets a tile. One the kitchen has not photographed
                  yet shows its initials rather than the hole a missing image
                  leaves in an otherwise even column. */}
              <div className="shrink-0 self-start">
                <DishPhoto
                  src={i.img}
                  name={i.name}
                  size={96}
                  className="size-[96px]"
                  sizes="(max-width: 420px) 96px, 116px"
                />
              </div>
            </article>
          ))}
        </div>
      </div>
    </GuestFlow>
  );
}

/* Option A — item customization: centred sheet, hairlines, no chrome */
export function ItemSheet({ data, itemId }: { data?: MenuScreenData & { itemId?: string }; itemId?: string } = {}) {
  const table = data?.table ?? null;
  const allItems = data?.items ?? demoItems;
  const restaurant = data?.restaurant ?? demoRestaurant;
  const requestedItemId = data?.itemId ?? itemId;

  // This sheet customises a dish, so it needs one that has portions to choose
  // between.
  //
  // Order matters, and getting it wrong is a visible regression: with no real
  // data the sheet must keep showing Butter Chicken, because that is what the
  // locked design has always shown here. Preferring "first item with variants"
  // unconditionally made it show Paneer Tikka instead.
  //
  // The original also did item.variants![0] unconditionally. That holds for
  // the demo data, where the chosen dish always has portions, but against a
  // real menu it throws the moment the item has none -- which is most of them.
  const requestedItem = requestedItemId
    ? allItems.find((i) => i.id === requestedItemId)
    : undefined;

  /**
   * The dish the link asked for does not exist.
   *
   * This used to fall through to the first dish on the menu, so a stale link
   * -- an old order, a screenshot, a menu edited since -- quietly opened
   * somebody else's dish and let the guest add and pay for it. Saying the dish
   * is gone, with a way back, is the only honest answer.
   */
  const missing = Boolean(requestedItemId) && !requestedItem;

  const item =
    requestedItem ??
    // Real menu, no id requested: show the menu's own first customisable dish.
    (data ? allItems.find((i) => i.variants && i.variants.length > 0) ?? allItems[0] : undefined) ??
    demoItems.find((i) => i.id === 'it-butter-chicken')!;

  const variants = item.variants ?? [];
  const groups: DisplayModifierGroup[] = item.modifiers ?? [];

  const [variant, setVariant] = useState(variants[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const cart = useCart();
  const router = useRouter();

  /**
   * The timer that takes the guest back to the menu after adding.
   *
   * Held in a ref so it can be cancelled: a guest who taps Back or closes the
   * sheet inside those 700ms was being pushed to the menu anyway, from a page
   * they had already left.
   */
  const returnTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (returnTimer.current !== null) window.clearTimeout(returnTimer.current);
  }, []);

  /**
   * Where closing the sheet goes.
   *
   * This used to be a bare "/menu", which threw away the restaurant and the
   * menu it came from -- against a configured database a bare /menu is not
   * the menu at all, it is "Open this menu from your table". So customising a
   * dish and then closing the sheet was a dead end, in production only.
   */
  const backHref = (() => {
    const params = new URLSearchParams();
    if (data?.restaurant.slug) params.set('s', data.restaurant.slug);
    if (data?.menuId) params.set('m', data.menuId);
    const query = params.toString();
    return query ? `/menu?${query}` : '/menu';
  })();

  /* The sheet is the last thing on the page, so Escape has to work or a
     keyboard user is stuck on a dish they did not mean to open. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') router.push(backHref);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, backHref]);

  /**
   * What has been picked in each add-on group, by option id.
   *
   * A required single-choice group starts with its first option already
   * picked. That is the honest reading of "required": a guest who does not
   * care still ends up with a valid answer, instead of a disabled button and
   * no explanation.
   */
  const [picks, setPicks] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const group of groups) {
      initial[group.id] =
        group.required && group.type === 'single' && group.options[0]
          ? [group.options[0].id]
          : [];
    }
    return initial;
  });

  const toggle = (group: DisplayModifierGroup, optionId: string) => {
    setPicks((current) => {
      const chosen = current[group.id] ?? [];

      if (group.type === 'single') return { ...current, [group.id]: [optionId] };

      if (chosen.includes(optionId)) {
        return { ...current, [group.id]: chosen.filter((id) => id !== optionId) };
      }

      // The owner's limit, applied at the moment of the click rather than on
      // the bill. Beyond it nothing happens, and the chips that would exceed
      // it are disabled, so the rule is visible before it is hit.
      const max = group.max ?? group.options.length;
      if (chosen.length >= max) return current;

      return { ...current, [group.id]: [...chosen, optionId] };
    });
  };

  const chosenAddonIds = groups.flatMap((group) => picks[group.id] ?? []);

  /**
   * What the add-ons add to ONE plate.
   *
   * Priced here from the menu's own numbers so the button and the bill agree
   * before the guest commits. The amount actually charged is still read from
   * the database when the order is written -- this is a preview, and the ids
   * are all that leave the browser.
   */
  const addonRupees = groups.reduce(
    (sum, group) =>
      sum +
      (picks[group.id] ?? []).reduce(
        (inner, id) => inner + (group.options.find((o) => o.id === id)?.price ?? 0),
        0,
      ),
    0,
  );

  /**
   * The portion being bought, and what the plate costs with its add-ons.
   *
   * A dish with no portions has no variant and is priced at its menu price.
   * A dish with portions is priced at the selected one -- which is the whole
   * point of asking. The button and the bill have to agree.
   */
  const chosenVariant = variants.find((v) => v.id === variant);
  const chosenUnitPrice = (chosenVariant?.price ?? item.price) + addonRupees;

  /**
   * How many more of this exact line the cart can hold.
   *
   * The sheet used to increment without a ceiling while the cart silently
   * stopped at 99, so the button could promise "Add to order · ₹12,400" for a
   * hundred plates and the cart would hold ninety-nine. The limit is shared
   * with lib/cart-storage.ts, and the button now says what will actually be
   * added.
   */
  const existingQty =
    cart.lines.find(
      (line) =>
        line.itemId === item.id &&
        (line.variantId ?? '') === (variant ?? '') &&
        [...(line.addonIds ?? [])].sort().join(',') === [...chosenAddonIds].sort().join(','),
    )?.qty ?? 0;
  const room = Math.max(0, 99 - existingQty);
  const addQty = Math.min(qty, room);
  const atCeiling = room === 0;

  if (missing) {
    return (
      <div className="mx-auto min-h-dvh w-full max-w-[560px] bg-paper px-5 py-16 text-gink">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-gink-46 uppercase">Not on the menu</p>
        <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-[-0.025em]">
          That dish is not on the menu
        </h1>
        <p className="mt-3 text-[14.5px] leading-[1.55] text-gink-64">
          The link may be from an older menu, or the restaurant has taken the dish off today.
          Nothing has been added to your order.
        </p>
        <Link
          href={backHref}
          className="g-primary mt-6 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold"
        >
          Back to the menu
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-paper text-gink">
      {/* The menu itself, still there behind the sheet. It is dimmed and made
          inert rather than removed: a guest who closes the sheet lands back on
          the dish they were reading, at the scroll position they left. */}
      <div className="pointer-events-none opacity-30 blur-[1.5px] select-none" aria-hidden="true">
        <header className="px-5 pt-6">
          <p className="text-[10.5px] font-semibold tracking-[0.12em] text-gink-46 uppercase">The menu</p>
          <h1 className="mt-1 truncate text-[24px] font-semibold tracking-[-0.02em]">{restaurant.name}</h1>
          <div className="mt-0.5 truncate text-[12px] text-gink-46">{restaurant.tagline}</div>
          {table ? (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.07em] text-[var(--p-accent)] uppercase">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--p-accent)]" />
              {table.label}
            </div>
          ) : null}
        </header>

        <div className="mt-4 flex flex-col gap-2 px-4">
          {allItems.slice(0, 4).map((i) => (
            <article key={i.id} className="flex gap-3 rounded-2xl border border-hair bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <VegMark veg={i.veg} />
                  <h2 className="truncate text-[15px] font-semibold">{i.name}</h2>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] text-gink-64">{i.desc}</p>
                <div className="tnum mt-1 text-[13.5px] font-semibold">{inr(i.price)}</div>
              </div>
              <DishPhoto src={i.img} name={i.name} size={84} className="size-[84px]" />
            </article>
          ))}
        </div>
      </div>

      {/* Two ways out that are not the small ×: the scrim, and Escape. The
          scrim is a link, not a div with a handler, so it works before any
          JavaScript has run and reads to a keyboard as what it is. */}
      <Link href={backHref} data-sheet-scrim="" aria-label="Close" tabIndex={-1} className="fixed inset-0 z-30" />

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[560px]">
        <div
          className="max-h-[86dvh] overflow-y-auto rounded-t-[26px] border border-hair bg-paper pb-[calc(14px+env(safe-area-inset-bottom))] shadow-g2"
          role="dialog"
          aria-modal="true"
          aria-label={item.name}
        >
          {/* The grab handle. A phone sheet without one does not read as a
              sheet, and the guest looks for a close button that is 20px from
              their thumb. */}
          <div className="sticky top-0 z-10 flex justify-center bg-paper pt-2.5 pb-1">
            <span aria-hidden="true" className="h-1 w-9 rounded-full bg-gink-28" />
          </div>

          <div className="px-5 pt-2">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {/* "Customize" over a dish with no portions and no add-ons is a
                    heading for a decision that does not exist. */}
                <p className="text-[10.5px] font-semibold tracking-[0.12em] text-[var(--p-accent)] uppercase">
                  {variants.length > 0 || groups.length > 0 ? 'Customize' : 'Add to order'}
                </p>
                <h2 className="mt-1 text-[23px] leading-tight font-semibold tracking-[-0.02em]">{item.name}</h2>
              </div>
              <Link
                href={backHref}
                aria-label="Close"
                className="-mr-1.5 grid size-9 shrink-0 place-items-center rounded-full bg-gink-07 text-[18px] text-gink-64 transition hover:text-gink"
              >
                ×
              </Link>
            </div>

            <p className="mt-2 text-[13.5px] leading-[1.5] text-gink-64">{item.desc}</p>

            {variants.length > 0 && (
              <section className="mt-5">
                <h3 className="text-[11px] font-semibold tracking-[0.1em] text-gink-46 uppercase">Portion</h3>
                <div className="mt-2 flex flex-col gap-1.5">
                  {variants.map((v) => {
                    const on = variant === v.id;
                    return (
                      <label
                        key={v.id}
                        className={[
                          'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors',
                          on ? 'border-[var(--p-accent)] bg-accent-soft' : 'border-hair bg-card hover:border-hair-strong',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="variant"
                          checked={on}
                          onChange={() => setVariant(v.id)}
                          className="sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={[
                            'grid size-4 shrink-0 place-items-center rounded-full border',
                            on ? 'border-[var(--p-accent)]' : 'border-gink-28',
                          ].join(' ')}
                        >
                          {on && <span className="size-2 rounded-full bg-[var(--p-accent)]" />}
                        </span>
                        <span className="flex-1 text-[14px] font-medium">{v.name}</span>
                        <span className="tnum text-[14px] font-semibold">{inr(v.price)}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            {/* The dish's own add-ons, defined by the restaurant. Every price
                shown here is one the till will charge: place_public_order reads
                item_addons for the amount. */}
            {groups.map((group) => {
              const chosen = picks[group.id] ?? [];
              const max = group.max ?? group.options.length;
              const atMax = group.type === 'multi' && chosen.length >= max;

              return (
                <section key={group.id} className="mt-5">
                  <h3 className="flex flex-wrap items-baseline gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
                    <span className="text-gink-64">{group.name}</span>
                    {group.required ? <span className="text-[var(--p-accent)]">· required</span> : null}
                    {group.type === 'multi' ? <span className="normal-case">· pick up to {max}</span> : null}
                  </h3>

                  {group.type === 'single' ? (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {group.options.map((option) => {
                        const on = chosen.includes(option.id);
                        return (
                          <label
                            key={option.id}
                            className={[
                              'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors',
                              on ? 'border-[var(--p-accent)] bg-accent-soft' : 'border-hair bg-card hover:border-hair-strong',
                            ].join(' ')}
                          >
                            <input
                              type="radio"
                              name={`addon-${group.id}`}
                              checked={on}
                              onChange={() => toggle(group, option.id)}
                              className="sr-only"
                            />
                            <span
                              aria-hidden="true"
                              className={[
                                'grid size-4 shrink-0 place-items-center rounded-full border',
                                on ? 'border-[var(--p-accent)]' : 'border-gink-28',
                              ].join(' ')}
                            >
                              {on && <span className="size-2 rounded-full bg-[var(--p-accent)]" />}
                            </span>
                            <span className="flex-1 text-[14px] font-medium">{option.name}</span>
                            <span className="tnum text-[13.5px] text-gink-64">
                              {option.price ? `+ ${inr(option.price)}` : '—'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {group.options.map((option) => {
                        const on = chosen.includes(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={on}
                            disabled={!on && atMax}
                            onClick={() => toggle(group, option.id)}
                            className={[
                              'rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                              on
                                ? 'border-[var(--p-accent)] bg-accent-soft text-[var(--p-accent)]'
                                : 'border-hair-strong text-gink-64 hover:text-gink',
                              'disabled:cursor-not-allowed disabled:opacity-40',
                            ].join(' ')}
                          >
                            {option.name}
                            {option.price ? ` + ${inr(option.price)}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {/* The action is part of the sheet, pinned to the bottom of it: a
              guest choosing an add-on at the top of a long sheet must still see
              what the plate costs before they commit. */}
          <div className="sticky bottom-0 mt-5 border-t border-hair bg-paper/96 px-5 pt-3 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex shrink-0 items-center rounded-full border border-hair-strong">
                <button
                  type="button"
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  aria-label="Decrease"
                  disabled={qty <= 1 || atCeiling}
                  className="grid size-9 place-items-center rounded-full text-[16px] text-gink-80 transition hover:bg-gink-07 disabled:opacity-30"
                >
                  −
                </button>
                <span className="tnum min-w-6 text-center text-[14px] font-semibold">{Math.max(1, addQty)}</span>
                <button
                  type="button"
                  onClick={() => setQty(Math.min(room, qty + 1))}
                  aria-label="Increase"
                  disabled={qty >= room || atCeiling}
                  className="grid size-9 place-items-center rounded-full text-[16px] text-gink-80 transition hover:bg-gink-07 disabled:opacity-30"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                aria-live="polite"
                disabled={atCeiling}
                onClick={() => {
                  // The dish, how many, which portion, and which add-ons. All
                  // ids: the server prices every one of them from the database,
                  // so what is sent can never be what is charged.
                  cart.add(item.id, addQty, chosenVariant?.id, chosenAddonIds);

                  // Confirm, then leave. Adding used to change a number on a bar
                  // behind an overlay and nothing else, so the obvious next move
                  // was to hunt for the close button -- which was broken. The
                  // button says what happened for a moment, then the guest is
                  // back on the menu, where the next dish is.
                  setAdded(true);
                  returnTimer.current = window.setTimeout(() => router.push(backHref), 700);
                }}
                className={[
                  'flex-1 rounded-full px-4 py-3 text-[13.5px] font-semibold transition active:scale-[0.99]',
                  added ? 'bg-brand text-white' : 'g-primary',
                  'disabled:opacity-50',
                ].join(' ')}
              >
                {added ? (
                  'Added to your order ✓'
                ) : atCeiling ? (
                  '99 is the most of one dish we take online'
                ) : (
                  <>
                    {/* Both are rupees already: item.price and variant.price
                        come from DisplayItem, which is in display units.
                        Passing them through paiseToRupees divided an
                        already-rupees number by a hundred, so a Rs 250 plate
                        showed as Rs 3. */}
                    Add to order · {inr(chosenUnitPrice * Math.max(1, addQty))}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
