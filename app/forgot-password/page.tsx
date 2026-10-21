import type { Metadata } from 'next';
import { ForgotPasswordScreen } from '@/components/screens/ForgotPasswordScreen';
import { getSingleSearchParam } from '@/lib/query-params';

export const metadata: Metadata = { title: 'Reset your password · AutoDine' };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error: rawError } = await searchParams;
  const error = getSingleSearchParam(rawError);
  return <ForgotPasswordScreen error={error.valid ? error.value : undefined} />;
}
