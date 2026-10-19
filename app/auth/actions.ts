/**
 * Sign up, sign in, sign out.
 *
 * Runs only on the server. Signup deliberately uses the SERVICE ROLE client
 * to create the restaurant, menu and membership, because there is no RLS
 * INSERT policy for restaurants: letting any authenticated user create
 * unlimited restaurants would be an abuse vector. Creation is therefore
 * gated behind this one controlled, validated server path.
 *
 * Errors redirect with a message in the query string rather than throwing,
 * because these are called directly by a <form action> in a Server Component
 * and there is no client-side state to hold an error in.
 */

'use server';

import { redirect } from 'next/navigation';
import { slugify, uniqueSlug } from '@/lib/slug';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;

async function rollbackSignup(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  userId: string,
  restaurantId?: string,
) {
  // Signup spans Supabase Auth and several Postgres inserts, which cannot share
  // one transaction. Compensate on failure so a partial workspace is not left
  // behind and logged as a successful registration.
  if (restaurantId) await admin.from('restaurants').delete().eq('id', restaurantId);
  await admin.from('profiles').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);
}

export async function signUpAction(formData: FormData): Promise<void> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const restaurantName = String(formData.get('restaurantName') ?? '').trim();
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const phone = String(formData.get('phone') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const agreed = formData.get('agree') === 'on';

  if (!fullName || !restaurantName) fail('/signup', 'Please enter your name and your restaurant name.');
  if (!EMAIL.test(email)) fail('/signup', 'Please enter a valid email address.');
  if (password.length < MIN_PASSWORD) fail('/signup', `Password must be at least ${MIN_PASSWORD} characters.`);
  // Preview-account data use must be explicitly acknowledged.
  if (!agreed) fail('/signup', 'Please confirm that you understand how this preview uses your account details.');

  const supabase = await createSupabaseServerClient();
  if (!supabase) fail('/signup', 'Sign-up is not available yet: the database is not connected.');

  const admin = getSupabaseAdmin();
  if (!admin) fail('/signup', 'Sign-up is temporarily unavailable. Please try again shortly.');

  const slug = await uniqueSlug(slugify(restaurantName), async (candidate) => {
    const { data } = await admin.from('restaurants').select('id').eq('slug', candidate).maybeSingle();
    return Boolean(data);
  });

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, phone } },
  });

  if (authError) fail('/signup', 'We could not create your account. Please try again.');

  const userId = authData.user?.id;
  if (!userId) fail('/signup', 'We could not create your account. Please try again.');
  // Supabase can return a user with no identities for an existing email when
  // email-enumeration protection is enabled. Do not create a second workspace.
  if (authData.user?.identities?.length === 0) {
    redirect('/login?notice=If%20an%20account%20can%20be%20used%20with%20that%20email%2C%20sign%20in%20instead.');
  }

  let restaurantId: string | undefined;
  try {
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: userId, full_name: fullName, phone }, { onConflict: 'id' });
    if (profileError) throw profileError;

    const { data: restaurant, error: restaurantError } = await admin
      .from('restaurants')
      .insert({ slug, name: restaurantName, timezone: 'Asia/Kolkata' })
      .select('id')
      .single();
    if (restaurantError) throw restaurantError;
    restaurantId = restaurant.id;

    const { error: menuError } = await admin
      .from('menus')
      .insert({ restaurant_id: restaurantId, name: 'Main menu', is_published: true });
    if (menuError) throw menuError;

    const { error: membershipError } = await admin
      .from('memberships')
      .insert({ restaurant_id: restaurantId, user_id: userId, role: 'owner' });
    if (membershipError) throw membershipError;
  } catch (error) {
    try {
      await rollbackSignup(admin, userId, restaurantId);
    } catch (rollbackError) {
      console.error('[autodine] signup rollback failed:', rollbackError);
    }
    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      console.error('[autodine] signup session cleanup failed:', signOutError);
    }
    console.error('[autodine] workspace creation failed:', error);
    fail('/signup', 'We could not finish setting up your workspace. Please try again.');
  }

  // With email confirmation ON there is no session yet. Sending them to the
  // dashboard would bounce them straight back out, so say what happened.
  if (!authData.session) {
    redirect('/login?notice=Check%20your%20email%20to%20confirm%20your%20address%2C%20then%20sign%20in.');
  }

  redirect('/dashboard');
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const requestedNext = String(formData.get('next') ?? '');
  // Only accept same-origin pathnames. Never turn the login form into an open redirect.
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//') && !requestedNext.includes('\\')
    ? requestedNext
    : '/dashboard';

  if (!email || !password) fail('/login', 'Please enter your email and password.');

  const supabase = await createSupabaseServerClient();
  if (!supabase) fail('/login', 'Sign-in is not available yet: the database is not connected.');

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Deliberately vague. "Invalid login credentials" is fine to show; telling
    // an attacker which of the two was wrong is not.
    fail('/login', 'Email or password is incorrect.');
  }

  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect('/login');
}
