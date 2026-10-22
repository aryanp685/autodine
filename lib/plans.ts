/**
 * Plans, and what is actually in the product.
 *
 * One source of truth. The pricing page, the plan cards on the home page and
 * the comparison table are all rendered from this file, so a claim cannot
 * exist in two places in two different shapes.
 *
 * ── WHAT THIS FILE IS CAREFUL ABOUT ────────────────────────────────────────
 *
 * Billing is not connected. There is no subscription table, no entitlement
 * check and no gateway in this deployment, so nothing here is purchasable and
 * no account is limited by it. The tiers are a plan for how the product will
 * be split, which is why every capability carries a state:
 *
 *   live      built, and in the product today for every account
 *   planned   not built yet; belongs to a tier when billing opens
 *
 * That split is the honest one. The previous pricing page sold "expanded
 * staff roles" and "higher plan limits" as if they were gated features when
 * roles were available to every account and no limit was enforced anywhere.
 * A price list that describes a product that does not exist is not a
 * placeholder, it is a false claim.
 */

export type PlanId = 'starter' | 'professional' | 'business';

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly, in rupees. Planning figures: nothing is charged. */
  price: number;
  /** One line, in the voice of the restaurant, not the vendor. */
  fit: string;
  /** The plan we would recommend, and why it is marked. */
  recommended?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 899,
    fit: 'One room, one menu, one counter.',
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 1599,
    fit: 'A full floor, a kitchen board and a manager.',
    recommended: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: 2699,
    fit: 'Several rooms, several screens, a team.',
  },
];

export type Capability = {
  id: string;
  label: string;
  detail: string;
  /**
   * Which plans it belongs to when billing opens.
   * 'all' means every plan, including the smallest.
   */
  tiers: PlanId[] | 'all';
  state: 'live' | 'planned';
};

/**
 * The product as it exists today.
 *
 * Everything here is built and switched on for every account: the trial is
 * not metered, features are not gated, and the smallest plan is not a demo.
 * That is deliberate — a restaurant that cannot take an order is not a
 * smaller customer.
 */
export const LIVE: Capability[] = [
  {
    id: 'menus',
    label: 'Menus and dish editing',
    detail:
      'Sections, dishes, prices, portions and add-ons, edited and published from the dashboard.',
    tiers: 'all',
    state: 'live',
  },
  {
    id: 'qr',
    label: 'Table cards and sessions',
    detail:
      'A card per table, a session that expires, and a menu that opens only where the card is.',
    tiers: 'all',
    state: 'live',
  },
  {
    id: 'ordering',
    label: 'Guest ordering',
    detail: 'Scan, six-digit code, cart, order. No app, no account, nothing to install.',
    tiers: 'all',
    state: 'live',
  },
  {
    id: 'kitchen',
    label: 'Kitchen board',
    detail: 'Tickets ordered by what needs cooking next, with the ticket read aloud.',
    tiers: 'all',
    state: 'live',
  },
  {
    id: 'cashier',
    label: 'Counter and receipts',
    detail: 'Billed and collected kept as two numbers, with the receipt printed from the browser.',
    tiers: 'all',
    state: 'live',
  },
  {
    id: 'reports',
    label: 'Reports',
    detail: 'Sales by day, item performance, and a CSV of exactly what is on screen.',
    tiers: 'all',
    state: 'live',
  },
];

/**
 * What the tiers will change, when billing opens.
 *
 * Kept short on purpose: four real differences are more useful than a matrix
 * of twenty rows where half are the same tick in every column.
 */
export const DIFFERENCES: Capability[] = [
  {
    id: 'outlets',
    label: 'Several outlets',
    detail:
      'Business runs more than one room under one owner account — separate menus, separate tables, one report.',
    tiers: ['business'],
    state: 'planned',
  },
  {
    id: 'roles',
    label: 'Manager roles',
    detail:
      'Professional and Business add managers who can run the floor and edit settings without owning the account.',
    tiers: ['professional', 'business'],
    state: 'planned',
  },
  {
    id: 'import',
    label: 'Menu import',
    detail:
      'Photograph or paste an existing menu and it is drafted for review instead of typed in.',
    tiers: ['professional', 'business'],
    state: 'planned',
  },
  {
    id: 'limits',
    label: 'Higher limits',
    detail:
      'Tables, staff seats and stored history grow with the plan. The numbers are not final, so they are not printed.',
    tiers: ['professional', 'business'],
    state: 'planned',
  },
  {
    id: 'support',
    label: 'Onboarding',
    detail: 'Business includes a guided setup: menus imported, tables printed, staff invited.',
    tiers: ['business'],
    state: 'planned',
  },
];

/**
 * A count, as a word.
 *
 * Headlines on the marketing pages say "Six things work. Three do not." and
 * "Five differences, not fifty." Those numbers are claims about lists that
 * live in this file, so they are derived from the lists rather than typed.
 * A hand-typed count is a claim that expires the first time somebody adds an
 * item, and expires silently.
 */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function numberWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/** The same word, capitalised, for the start of a sentence. */
export function NumberWord(n: number): string {
  const word = numberWord(n);
  return word[0].toUpperCase() + word.slice(1);
}

/** Everything the pricing page needs, in the order it should be read. */
export const CAPABILITIES: Capability[] = [...LIVE, ...DIFFERENCES];

/** Capabilities that are in every plan — today, all of them. */
export function capabilitiesFor(planId: PlanId): Capability[] {
  return CAPABILITIES.filter((c) => c.tiers === 'all' || c.tiers.includes(planId));
}

/** How many of the live capabilities a plan includes. Used as the card's count. */
export function liveCountFor(planId: PlanId): number {
  return LIVE.filter((c) => c.tiers === 'all' || c.tiers.includes(planId)).length;
}

/**
 * What this deployment does NOT do.
 *
 * Kept beside the live list because the home page shows both together: a
 * product that only advertises what works is a brochure, and the three things
 * below are the ones a buyer would otherwise assume are included.
 */
export const NOT_CONNECTED = [
  {
    id: 'payments',
    label: 'Card and UPI payments',
    detail: 'No gateway is connected. Orders are paid at the counter and recorded there.',
  },
  {
    id: 'billing',
    label: 'Plans and subscriptions',
    detail: 'No plan can be bought and no account is limited, metered or locked.',
  },
  {
    id: 'messages',
    label: 'Messages and reminders',
    detail: 'Nothing is sent by SMS or WhatsApp — not receipts, not trial reminders.',
  },
];

/**
 * The state of billing, in one place, because it is said in four.
 *
 * Nothing in this deployment can charge anybody: there are no gateway keys and
 * no subscription table. Every screen that mentions money reads this.
 */
export const BILLING = {
  connected: false,
  /** When billing opens, plans are monthly and the trial runs this long. */
  trialDays: 10,
  /** Shown wherever a price appears. */
  note: 'Planning figures. Plans are not on sale and nothing is charged.',
} as const;
