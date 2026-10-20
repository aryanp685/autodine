import type { Metadata } from 'next';
import { ResetPasswordScreen } from '@/components/screens/ResetPasswordScreen';
import { getSingleSearchParam } from '@/lib/query-params';

export const metadata: Metadata = { title: 'Choose a new password · AutoDine' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error: rawError } = await searchParams;
  const error = getSingleSearchParam(rawError);
  return <ResetPasswordScreen error={error.valid ? error.value : undefined} />;
}
