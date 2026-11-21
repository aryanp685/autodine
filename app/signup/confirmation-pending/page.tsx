import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SignupConfirmationPendingScreen } from '@/components/screens/SignupConfirmationPendingScreen';
import { normalizeAuthEmail, PENDING_SIGNUP_EMAIL_COOKIE } from '@/lib/signup-confirmation';

export const metadata: Metadata = { title: 'Confirm your email · AutoDine' };

export default async function SignupConfirmationPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  const [{ link }, cookieStore] = await Promise.all([searchParams, cookies()]);
  const email = normalizeAuthEmail(cookieStore.get(PENDING_SIGNUP_EMAIL_COOKIE)?.value);

  return <SignupConfirmationPendingScreen email={email} linkProblem={link === 'problem'} />;
}
