import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { ResetPasswordScreen } from '@/components/screens/ResetPasswordScreen';
import { RECOVERY_COOKIE } from '@/lib/password';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Choose a new password · AutoDine' };

/**
 * The page reads the session cookie the emailed link established, so it can
 * never be cached and served to the wrong person: every request asks Supabase
 * who is signed in.
 */
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  // Both halves are needed: a session AND the fifteen-minute permission that
  // only a recovery link leaves behind. Without the second, anybody who is
  // merely signed in could replace the password.
  const cookieStore = await cookies();
  const canSetPassword = Boolean(user) && cookieStore.get(RECOVERY_COOKIE)?.value === '1';

  return <ResetPasswordScreen email={canSetPassword ? (user?.email ?? null) : null} error={error} />;
}
