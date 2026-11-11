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

/**
 * What a plan may use, in code.
 *
 * This is the same six-line matrix as public.plan_features() in migration
 * 20261026001200, and lib/plans.test.ts parses that file and fails if the two
 * disagree. It exists client-side for one reason: a screen must be able to say
 * "menu import is on Professional" before it renders the control. The SERVER
 * still decides — lib/entitlements.ts asks the database — because a hidden
 * button is not a permission.
 *
 * `trial` carries everything. A restaurant evaluating the product for three
 * weeks and unable to import its menu is not evaluating the product.
 */
export type FeatureId =
  | 'menus'
  | 'qr'
  | 'ordering'
  | 'kitchen'
  | 'cashier'
  | 'reports'
  | 'roles'
  | 'import'
  | 'outlets'
  | 'support';

export const ALL_FEATURES: FeatureId[] = [
  'menus',
  'qr',
  'ordering',
  'kitchen',
  'cashier',
  'reports',
  'roles',
  'import',
  'outlets',
  'support',
];

/** Deny by default: an unknown plan is not in this record at all. */
export const ENTITLEMENTS: Record<PlanId | 'trial', FeatureId[]> = {
  trial: ALL_FEATURES,
  starter: ['menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports'],
  professional: ['menus', 'qr', 'ordering', 'kitchen', 'cashier', 'reports', 'roles', 'import', 'outlets'],
  business: ALL_FEATURES,
};

/** Does this plan include this feature? Unknown plan or feature -> false. */
export function planHasFeature(plan: string, feature: string): boolean {
  const list = (ENTITLEMENTS as Record<string, FeatureId[] | undefined>)[plan];
  return Array.isArray(list) && list.includes(feature as FeatureId);
}

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly, in rupees. Planning figures: nothing is charged. */
  price: number;
  /** One line, in the voice of the restaurant, not the vendor. */
  fit: string;
  /**
   * How many outlets one account may own on this plan. `null` is unlimited.
   * Mirrors public.account_outlet_limit() in migration 20261110001000;
   * lib/plans.test.ts parses that file so the two cannot drift.
   */
  outlets: number | null;
  /** The plan we would recommend, and why it is marked. */
  recommended?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 999,
    fit: 'One room, one menu, one counter.',
    outlets: 1,
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 2699,
    fit: 'A full floor, a kitchen board and a manager.',
    outlets: 5,
    recommended: true,
  },
  {
    id: 'business',
    name: 'Business',
    price: 3699,
    fit: 'Several rooms, several screens, a team.',
    outlets: null,
  },
];

/**
 * Outlets per plan, keyed the way the database keys them.
 *
 * `null` is unlimited (Business). `trial` is the same number the product has
 * always used as its self-serve stop: adding an outlet is free and anonymous
 * until a plan is chosen, so an unbounded "add outlet" button is an unbounded
 * free trial. The trial shows every feature; it is not a licence to mint
 * unlimited workspaces.
 */
export const PLAN_OUTLET_LIMITS: Record<PlanId | 'trial', number | null> = {
  trial: 5,
  starter: 1,
  professional: 5,
  business: null,
};

/**
 * How many outlets this plan allows. `null` is unlimited.
 *
 * Unknown plan -> the smallest allowance, because an unrecognised tier must
 * never be read as "unlimited". Note the `in` check: Business's allowance is
 * `null`, and `??` would replace that null with the fallback.
 */
export function planOutletLimit(plan: string): number | null {
  const table = PLAN_OUTLET_LIMITS as Record<string, number | null | undefined>;
  return plan in table ? (table[plan] ?? null) : PLAN_OUTLET_LIMITS.starter;
}

/** "1 outlet" / "5 outlets" / "Unlimited outlets". Never says "null". */
export function outletLimitLabel(limit: number | null): string {
  if (limit === null) return 'Unlimited outlets';
  return `${limit} ${limit === 1 ? 'outlet' : 'outlets'}`;
}

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
    label: 'Card payments',
    detail:
      'No card gateway is connected and no money is taken by AutoDine. Guests pay at the counter, or into the restaurant\'s own UPI QR, and staff record what arrived.',
  },
  {
    id: 'billing',
    label: 'Buying a plan',
    detail:
      `No plan can be bought yet. A new account runs on the whole product for ${21} days; after that it is read-only until access is extended by hand.`,
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
  /**
   * Twenty-one days, and it is not copy: public.account_can_write() and the
   * new-account path in migration 20261110001000 both use
   * `interval '21 days'`, and lib/plans.test.ts reads that file so the two
   * numbers cannot drift. lib/trial.ts holds the app-side constant.
   *
   * The interval is how a NEW trial is measured. A trial that was already
   * running when the length changed keeps its own activation date and runs 21
   * days from it, and one that had already expired stays expired -- both are
   * materialised per account in `accounts.trial_ends_at`, not recomputed here.
   */
  trialDays: 21,
  /** Shown wherever a price appears. */
  note: 'Planning figures. Plans are not on sale and nothing is charged.',
} as const;
