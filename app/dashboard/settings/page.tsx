import type { Metadata } from 'next';
import { SettingsScreen } from '@/components/screens/SettingsScreen';
import { getSettingsScreenData } from '@/lib/db/settings-screen';
import { getOutletBar } from '@/lib/db/outlet-bar';
import { onlinePaymentsConfigured } from '@/lib/payments/razorpay';

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
  const [data, outlet] = await Promise.all([getSettingsScreenData(), getOutletBar()]);

  return (
    <SettingsScreen
      data={data}
      outlet={outlet}
      error={error}
      notice={notice}
      // Read on the server: whether this deployment can verify a payment at
      // all. The switch below is the owner's; this is the server's.
      gatewayConfigured={onlinePaymentsConfigured()}
    />
  );
}
