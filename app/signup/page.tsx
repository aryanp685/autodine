import type { Metadata } from 'next';
import { SignupScreen } from '@/components/screens/SignupScreen';
import { getSingleSearchParam } from '@/lib/query-params';

export const metadata: Metadata = { title: 'Create your restaurant account · AutoDine' };

export default async function SignupPage({
  searchParams,
}: {
    searchParams: Promise<{ error?: string | string[] }>;
  }) {
  const { error: rawError } = await searchParams;
  const error = getSingleSearchParam(rawError);
  return <SignupScreen error={error.valid ? error.value : undefined} />;
}
