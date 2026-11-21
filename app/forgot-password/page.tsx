import type { Metadata } from 'next';
import { ForgotPasswordScreen } from '@/components/screens/ForgotPasswordScreen';

export const metadata: Metadata = { title: 'Reset your password · AutoDine' };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  return <ForgotPasswordScreen error={error} notice={notice} />;
}
