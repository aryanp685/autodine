/**
 * Saving Settings.
 *
 * THE TWO THINGS THIS FILE IS CAREFUL ABOUT
 *
 * 1. The restaurant id is never read from the form. It comes from the caller's
 *    membership row (lib/db/staff.ts), so a forged payload cannot point at
 *    another restaurant. RLS would refuse that anyway, but relying on the
 *    policy to catch a mistake we can avoid is how a "just this once" service
 *    role ends up in a request path.
 *
 * 2. A write that changes nothing is reported as a failure, not a success.
 *    Until migration 00500 there was NO update policy on public.restaurants,
 *    so an UPDATE from the dashboard matched zero rows and returned no error:
 *    the screen would have said "Saved" over a row that never changed. Every
 *    update here therefore asks for the row back and treats an empty result as
 *    a refusal. `.update()` without `.select()` cannot tell those apart.
 *
 * ON ROLES
 *
 * Only owner and manager may change these fields. That is enforced twice: here
 * (so the button is disabled and the message is readable) and in the database
 * (so a hand-made request is refused). A client-side check alone is a
 * suggestion, and a server-side check alone means a cashier taps Save and gets
 * a Postgres error instead of "ask your owner".
 *
 * ON THE TRIAL GATE
 *
 * These writes are deliberately NOT gated by restaurant_can_write(), which
 * refuses workspace writes once a trial has lapsed. An expired workspace must
 * still be able to correct its name, phone number and GSTIN — those are what
 * an invoice and a payment are addressed to. The gate belongs on the features
 * that consume the workspace, which is where it already is.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getStaffContextDetailed } from '@/lib/db/staff';
import { canEditSettings, formatTaxPercent, parseTaxPercent, validateDetails } from '@/lib/settings-input';

const SETTINGS_PATH = '/dashboard/settings';

/** Paths that show something this screen can change. */
const AFFECTED_PATHS = ['/dashboard/settings', '/dashboard', '/menu', '/menu/cart', '/menu/checkout'];

function fail(message: string): never {
  redirect(`${SETTINGS_PATH}?error=${encodeURIComponent(message)}`);
}

function done(message: string): never {
  redirect(`${SETTINGS_PATH}?notice=${encodeURIComponent(message)}`);
}

/**
 * Resolve the restaurant and prove the caller may write to it.
 *
 * Returns the context (supabase client included) or redirects with an error.
 */
async function requireEditor() {
  const staff = await getStaffContextDetailed();

  if (!staff.ok) {
    if (staff.reason === 'signed-out') fail('You need to be signed in to change settings.');
    if (staff.reason === 'no-membership') fail('This account is not a member of any restaurant yet.');
    fail('The database is not connected, so there is nothing to save to.');
  }

  if (!canEditSettings(staff.context.role)) {
    fail('Only the owner or a manager can change these settings. Ask them to make this change.');
  }

  return staff.context;
}

/**
 * A readable sentence for a write the database refused.
 *
 * Anything unrecognised is logged and replaced with one fixed line: a raw
 * Postgres message tells an owner nothing and leaks the schema to anyone who
 * can make the browser post the form.
 */
function writeFailure(context: string, error: { code?: string; message: string }): never {
  if (error.code === '23505') {
    fail('That web address is already used by another restaurant. Try a different one.');
  }
  if (error.code === '42501') {
    fail('The database refused this change for your account. Only the owner or a manager can make it.');
  }
  if (error.code === '23514') {
    fail('The database refused that value. Check the tax rate and try again.');
  }
  console.error(`[settings] ${context} failed`, error);
  fail('We could not save that. Nothing was changed — please try again.');
}

export async function saveDetailsAction(formData: FormData): Promise<void> {
  const { supabase, restaurantId } = await requireEditor();

  const parsed = validateDetails({
    name: formData.get('name'),
    tagline: formData.get('tagline'),
    address: formData.get('address'),
    phone: formData.get('phone'),
    gstin: formData.get('gstin'),
    slug: formData.get('slug'),
  });

  if (!parsed.ok) fail(parsed.message);

  // Read the current address before deciding whether the slug is part of this
  // write. Sending an unchanged slug back would be harmless but would also
  // re-run the unique constraint on every save, and an owner renaming their
  // restaurant does not want "address taken" about their own address.
  const { data: current, error: readError } = await supabase
    .from('restaurants')
    .select('slug')
    .eq('id', restaurantId)
    .maybeSingle();

  if (readError) writeFailure('reading the current restaurant', readError);
  if (!current) fail('This account has no restaurant to save to.');

  const slugChanged = parsed.value.slug !== current.slug;
  if (slugChanged && formData.get('slugConfirm') !== 'on') {
    fail(
      'Your public web address changed. Tick the box to confirm, because every existing link and printed standee with the old address stops working.'
    );
  }

  const patch = {
    name: parsed.value.name,
    tagline: parsed.value.tagline,
    address: parsed.value.address,
    phone: parsed.value.phone,
    gstin: parsed.value.gstin,
    ...(slugChanged ? { slug: parsed.value.slug } : {}),
  };

  const { data: saved, error } = await supabase
    .from('restaurants')
    .update(patch)
    .eq('id', restaurantId)
    .select('id');

  if (error) writeFailure('saving restaurant details', error);

  // Zero rows and no error is what a missing RLS policy looks like. Saying
  // "Saved" here is the exact lie this check exists to prevent.
  if (!saved || saved.length === 0) {
    fail('Nothing was saved. Your account can see this restaurant but is not allowed to change it.');
  }

  for (const path of AFFECTED_PATHS) revalidatePath(path);

  done(
    slugChanged
      ? `Saved. Your public address is now /menu?s=${parsed.value.slug} — links and printed cards with the old one no longer work.`
      : 'Saved. The menu page, bills and receipts now use these details.'
  );
}

/**
 * Switch card/UPI payment on or off for this outlet.
 *
 * A checkbox, so "absent from the form" means OFF and is not an error -- the
 * browser omits an unticked box entirely. Reading it as `=== 'on'` makes the
 * off state expressible; reading it with String(formData.get(...)) would make
 * the absence the string "null" and quietly switch it on.
 *
 * No environment check here. An owner may switch this on before the deployment
 * has a gateway key; the guest screen is what refuses to draw a pay button in
 * that case, and says so. Refusing the save would leave the owner with nothing
 * to do but guess.
 */
export async function saveOnlinePaymentsAction(formData: FormData): Promise<void> {
  const { supabase, restaurantId } = await requireEditor();

  const enabled = formData.get('onlinePayments') === 'on';

  const { data: saved, error } = await supabase
    .from('restaurants')
    .update({ online_payments_enabled: enabled })
    .eq('id', restaurantId)
    .select('id');

  if (error) writeFailure('switching online payments', error);
  if (!saved || saved.length === 0) {
    fail('Nothing was saved. Your account can see this restaurant but is not allowed to change it.');
  }

  for (const path of AFFECTED_PATHS) revalidatePath(path);
  // The guest's order screen is not in AFFECTED_PATHS: it is per-order and
  // force-dynamic, so it re-reads this switch on the next request anyway.

  done(
    enabled
      ? 'Card and UPI payment is on. Guests will see a pay button on their order page once this deployment has gateway keys.'
      : 'Card and UPI payment is off. Guests pay at the counter, and no pay button is shown.',
  );
}

export async function saveTaxAction(formData: FormData): Promise<void> {
  const { supabase, restaurantId } = await requireEditor();

  const parsed = parseTaxPercent(formData.get('taxRate'));
  if (!parsed.ok) fail(parsed.message);

  const { data: saved, error } = await supabase
    .from('restaurants')
    .update({ tax_rate_bps: parsed.bps })
    .eq('id', restaurantId)
    .select('id');

  if (error) writeFailure('saving the tax rate', error);
  if (!saved || saved.length === 0) {
    fail('Nothing was saved. Your account can see this restaurant but is not allowed to change it.');
  }

  for (const path of AFFECTED_PATHS) revalidatePath(path);

  done(
    parsed.bps === 0
      ? 'Tax set to 0%. Bills will now show no tax at all — set a rate here before you start billing.'
      : `Tax set to ${formatTaxPercent(parsed.bps)}%. New orders are billed at this rate; orders already placed keep the tax they were charged.`
  );
}
