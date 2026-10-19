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
  return (
    <LoginScreen
      error={error.valid ? error.value : undefined}
      notice={notice.valid ? notice.value : undefined}
      next={next.valid ? next.value : undefined}
    />
  );
}
