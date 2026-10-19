import type { Metadata } from 'next';
import { LoginScreen } from '@/components/screens/LoginScreen';

export const metadata: Metadata = { title: 'Sign in · AutoDine' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; next?: string }>;
}) {
  const { error, notice } = await searchParams;
  return <LoginScreen error={error} notice={notice} />;
}
