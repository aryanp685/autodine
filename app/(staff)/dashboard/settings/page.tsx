import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { SettingsScreen } from '@/components/screens/SettingsScreen';
import { getSettingsScreenData } from '@/lib/db/settings-screen';
import { getTeamScreenData } from '@/lib/db/team';
import { getOutletBar } from '@/lib/db/outlet-bar';
import { onlinePaymentsConfigured } from '@/lib/payments/razorpay';
import { siteOrigin } from '@/lib/site-origin';
import { INVITE_FLASH_COOKIE, parseInviteFlash } from '@/lib/team-invite';

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
  const [data, outlet, team, origin] = await Promise.all([
    getSettingsScreenData(),
    getOutletBar(),
    getTeamScreenData(),
    siteOrigin(),
  ]);

  /* A code minted moments ago, carried from the action in an httpOnly cookie
     rather than in the URL. Read here, drawn once, and gone in ten minutes --
     the database never held it. */
  const store = await cookies();
  const teamFlash = parseInviteFlash(store.get(INVITE_FLASH_COOKIE)?.value);

  return (
    <SettingsScreen
      data={data}
      outlet={outlet}
      team={team}
      teamFlash={teamFlash}
      origin={origin}
      error={error}
      notice={notice}
      // Read on the server: whether this deployment can verify a payment at
      // all. The switch below is the owner's; this is the server's.
      gatewayConfigured={onlinePaymentsConfigured()}
    />
  );
}
