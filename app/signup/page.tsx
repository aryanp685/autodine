import type { Metadata } from 'next';
import { SignupScreen } from '@/components/screens/SignupScreen';

export const metadata: Metadata = { title: 'Create your restaurant account · AutoDine' };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <SignupScreen error={error} />;
}
