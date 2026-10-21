import type { Metadata } from 'next';
import { LoginScreen } from '@/components/screens/LoginScreen';
import { getSingleSearchParam } from '@/lib/query-params';

export const metadata: Metadata = { title: 'Sign in · AutoDine' };

export default async function LoginPage({
  searchParams,
}: {
    searchParams: Promise<{ error?: string | string[]; notice?: string | string[]; next?: string | string[] }>;
  }) {
  const raw = await searchParams;
  const error = getSingleSearchParam(raw.error);
  const notice = getSingleSearchParam(raw.notice);
  const next = getSingleSearchParam(raw.next);
  const noticeMessage = notice.valid
    ? notice.value === 'password-updated'
      ? 'Password updated. Sign in with your new password.'
      : notice.value === 'email-confirmed'
        ? 'Email confirmed. You can now sign in.'
        : notice.value
    : undefined;
  return (
    <LoginScreen
      error={error.valid ? error.value : undefined}
      notice={noticeMessage}
      next={next.valid ? next.value : undefined}
    />
  );
}
