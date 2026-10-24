import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CodeDisplay } from '@/components/owner/CodeDisplay';
import { getStaffContextDetailed } from '@/lib/db/staff';

export const metadata: Metadata = {
  title: 'Guest code display · AutoDine',
  // Staff-only, and there is nothing here for a search visitor to see.
  robots: { index: false, follow: false },
};

// The digits change on a ten-minute clock; a cached copy would show a code
// that has already rolled.
export const dynamic = 'force-dynamic';

/**
 * The code a guest reads, at the size a guest can read it.
 *
 * WHERE THE NUMBER COMES FROM
 *
 * current_verification_code() -- the same server-side function the Tables
 * screen uses. It is granted to signed-in staff only, checks the caller's
 * membership of the restaurant before answering, and derives the digits from a
 * secret that never leaves the database. Nothing here is public: the page is
 * behind the dashboard proxy, and a guest reaches these six digits by looking
 * at a screen in the room, which is exactly the proof the code is meant to be.
 *
 * WHY A WHOLE PAGE
 *
 * The code used to live only in a panel on Tables & QR -- a screen an owner
 * uses at a desk. Handing a guest the digits then meant reading them out.
 * Leaving this open on a tablet at the counter does the same job for every
 * guest at once, without anybody having to be asked.
 */
export default async function DisplayPage() {
  const staff = await getStaffContextDetailed();
  if (!staff.ok) redirect('/login?next=%2Fdashboard%2Fdisplay');

  const { supabase, restaurantId, restaurantName } = staff.context;

  const { data, error } = await supabase.rpc('current_verification_code', {
    p_restaurant_id: restaurantId,
  });

  if (error) {
    console.error('[display] could not read the verification code', error);
  }

  const row = Array.isArray(data) ? data[0] : data;

  // No code is a real state (a restaurant whose secret could not be created,
  // or a database that did not answer). Saying so on the board is better than
  // drawing six zeros that a guest would try to type.
  if (!row || typeof row.code !== 'string') {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper px-6 text-center text-gink">
        <div className="max-w-[52ch]">
          <h1 className="text-[20px] font-semibold">The guest code is not available</h1>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-gink-64">
            This screen could not read the restaurant&rsquo;s verification code. Guests can still
            order with staff at the counter. Reopen Dashboard → Tables &amp; QR, then refresh this
            page.
          </p>
          <a
            href="/dashboard/tables"
            className="mt-5 inline-block text-[12.5px] font-semibold text-[var(--p-accent)] underline underline-offset-4"
          >
            Back to Tables &amp; QR
          </a>
        </div>
      </main>
    );
  }

  return (
    <CodeDisplay
      code={row.code}
      expiresAt={row.expires_at}
      windowSeconds={row.window_seconds ?? 600}
      restaurantName={restaurantName}
    />
  );
}
