import type { Metadata } from 'next';
import { SettingsScreen } from '@/components/screens/SettingsScreen';
import { getSettingsScreenData } from '@/lib/db/settings-screen';

export const metadata: Metadata = {
  title: 'Settings · AutoDine',
  robots: { index: false, follow: false },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;

  // Null means Supabase is not configured. The screen then renders itself
  // disabled with an explanation, never with sample values: this form writes.
  const data = await getSettingsScreenData();

  return <SettingsScreen data={data} error={error} notice={notice} />;
}
