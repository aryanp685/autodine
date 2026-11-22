/**
 * Onboarding wizard — the config-driven skeleton.
 *
 * WHY A CONFIG, NOT A HARD-CODED SCREEN
 *
 * The wizard is the first thing a new owner sees after signing up, and the
 * number and order of its steps are a product decision that changes more often
 * than the screens inside them. So the sequence lives here as data — one array,
 * read in order — and the page at `app/(staff)/onboarding` renders whatever it
 * finds. Adding or reordering a step is a one-line edit here, not a new route.
 *
 * WHAT THIS MODULE IS NOT
 *
 * It does not write anything. `isOnboardingComplete` is a read-only hint built
 * on the server's `restaurant_access()` projection (see lib/db/staff.ts and
 * lib/access.ts); the database remains the authority for every write a real
 * step would perform. A "complete" verdict here only decides whether a signed-in
 * owner is sent to the dashboard instead of the wizard — it never grants a
 * capability.
 *
 * "Complete" is deliberately conservative about what it can prove. A writable,
 * non-read-only restaurant is treated as onboarded; a read-only or non-writable
 * one is not, because sending an expired or restricted account "backwards" into
 * setup would be the wrong direction. A deployment that predates the detailed
 * `restaurant_access()` fields therefore falls through to the safe side rather
 * than being declared finished on a guess.
 */

import type { RestaurantAccess } from './access';

/**
 * One step in the sequence.
 *
 * `component` is a stable string key, not a React component: this module is
 * imported by the server page and the client wizard alike, and a component
 * reference cannot cross that boundary. The wizard owns the key→component map.
 */
export type OnboardingStep = {
  id: string;
  /** Human-facing name shown in the stepper and the step header. */
  title: string;
  /** Key resolved to a lazy-loaded placeholder by the wizard. */
  component: string;
  /** Whether the step must be completed before finishing. */
  required: boolean;
  /** Whether the owner may continue past it without doing the work. */
  canSkip: boolean;
};

/**
 * The default sequence, in order.
 *
 * Only `staff` is skippable: inviting a team is the one step a solo owner
 * legitimately has nobody to add yet, and blocking them on it would strand the
 * wizard. `finish` is required and always last. Keep ids unique — the stepper
 * keys and the `?step=` deep link both assume it.
 */
export const DEFAULT_ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 'welcome', title: 'Welcome', component: 'WelcomeStep', required: true, canSkip: false },
  { id: 'outlet', title: 'Outlet', component: 'OutletStep', required: true, canSkip: false },
  { id: 'menu', title: 'Menu', component: 'MenuStep', required: true, canSkip: false },
  { id: 'tables', title: 'Tables', component: 'TablesStep', required: true, canSkip: false },
  { id: 'staff', title: 'Staff', component: 'StaffStep', required: false, canSkip: true },
  { id: 'finish', title: 'Finish', component: 'FinishStep', required: true, canSkip: false },
];

/** The sequence to render. A copy, so a caller cannot mutate the source. */
export function getOnboardingSteps(): OnboardingStep[] {
  return DEFAULT_ONBOARDING_STEPS.map((step) => ({ ...step }));
}

/** Find a step by id. Returns undefined for an unknown id. */
export function stepById(id: string): OnboardingStep | undefined {
  return DEFAULT_ONBOARDING_STEPS.find((step) => step.id === id);
}

/**
 * Optional data-presence facts a step could later supply to sharpen the check.
 *
 * A real wizard would read these from the database (does the outlet have a menu
 * yet, are there any tables). The skeleton has no such reads, so every field is
 * optional and, when absent, is not treated as a failure — the conservative
 * writability gate below is the whole decision.
 */
export type OnboardingProgress = {
  hasOutlet?: boolean;
  hasMenu?: boolean;
  hasTables?: boolean;
};

/**
 * Is this restaurant finished with onboarding?
 *
 * Built on the same projection the staff screens use (`restaurant_access()`
 * via lib/db/staff.ts). The server is the authority for everything a real step
 * would write; this only decides whether the owner is redirected to the
 * dashboard or shown the wizard.
 *
 * Rules, in order:
 *   - no access at all (signed out, unconfigured, no membership) -> false
 *   - a read-only restaurant (expired trial / restricted) -> false
 *   - a restaurant that cannot write -> false
 *   - otherwise, if explicit progress facts are given, all must be present
 *   - otherwise -> true (a writable restaurant is treated as onboarded)
 */
export function isOnboardingComplete(
  access: RestaurantAccess | null | undefined,
  progress?: OnboardingProgress,
): boolean {
  if (!access) return false;
  if (access.readOnly === true) return false;
  if (access.canWrite === false) return false;

  if (progress) {
    if (progress.hasOutlet === false) return false;
    if (progress.hasMenu === false) return false;
    if (progress.hasTables === false) return false;
  }

  return true;
}

/**
 * Validate and clamp a requested step index against the sequence.
 *
 * Accepts a string (a `?step=` value that may be a number or a step id) and a
 * fallback index. Returns a zero-based index that is always within range, so a
 * crafted or stale URL can never render a blank wizard.
 */
export function resolveStepIndex(requested: string | undefined, fallback = 0): number {
  const steps = DEFAULT_ONBOARDING_STEPS;
  const last = steps.length - 1;

  if (requested == null || requested === '') return clampIndex(fallback, last);

  // By id first, then by 1-based number as typed by a human.
  const byId = steps.findIndex((step) => step.id === requested);
  if (byId !== -1) return byId;

  const asNumber = Number(requested);
  if (Number.isFinite(asNumber)) return clampIndex(Math.trunc(asNumber) - 1, last);

  return clampIndex(fallback, last);
}

function clampIndex(index: number, last: number): number {
  if (!Number.isFinite(index)) return 0;
  if (index < 0) return 0;
  if (index > last) return last;
  return Math.trunc(index);
}