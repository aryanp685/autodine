'use client';

/**
 * Admin: trial renewal page.
 *
 * Lets an administrator renew a restaurant's 7-day trial by entering
 * the restaurant name and clicking the button. The renewal is
 * server-side only — the Supabase admin client (service role) is
 * used, which bypasses RLS. The protect_restaurant_plan() trigger
 * allows the write because auth.uid() is null (service role).
 *
 * This page is NOT linked from the main navigation. It is an
 * operational tool for specific situations (e.g. a restaurant whose
 * trial expired and needs a fresh 7 days).
 */

import { useState } from 'react';
import { renewTrialAction } from './actions';

export default function RenewTrialPage() {
  const [restaurantName, setRestaurantName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | { ok: boolean; message: string }>(null);

  async function handleRenew() {
    if (!restaurantName.trim()) return;
    setLoading(true);
    setResult(null);
    const res = await renewTrialAction(restaurantName.trim());
    if (res.ok && res.restaurantName && res.trialEndsAt) {
      setResult({
        ok: true,
        message: `Trial renewed for "${res.restaurantName}". New trial ends at ${new Date(res.trialEndsAt).toLocaleString('en-IN')}.`,
      });
    } else {
      setResult({ ok: false, message: res.error ?? 'Unknown error' });
    }
    setLoading(false);
  }

  return (
    <main className="mx-auto w-full max-w-[620px] flex-1 px-5 py-12">
      <p className="g-eyebrow">Admin</p>
      <h1 className="g-display mt-2.5 text-[30px]">Renew trial</h1>
      <div className="mt-4 text-[14.5px] leading-[1.6] text-gink-64">
        <p className="max-w-[54ch]">
          Renew a restaurant's 7-day trial. The trial clock is server-side
          (<code className="text-gink-80">trial_started_at + 7 days</code>),
          so this must be done from the server. Enter the exact restaurant
          name and click renew.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <label className="text-[12.5px] font-semibold tracking-[0.16em] text-gink uppercase">
          Restaurant name
        </label>
        <input
          type="text"
          value={restaurantName}
          onChange={(e) => setRestaurantName(e.target.value)}
          placeholder="The King"
          className="w-full rounded-[var(--p-r-card)] border border-hair bg-card px-4 py-3 text-[15px] text-gink outline-none focus:border-gink-40"
        />

        <button
          onClick={handleRenew}
          disabled={loading || !restaurantName.trim()}
          className="mt-2 inline-flex h-11 items-center justify-center rounded-full px-5 text-[13px] font-semibold transition active:scale-[0.99] g-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Renewing…' : 'Renew trial'}
        </button>

        {result && (
          <div
            className={`mt-4 rounded-[var(--p-r-card)] border px-4 py-3 text-[14px] leading-[1.5] ${
              result.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-80'
                : 'border-red-200 bg-red-50 text-red-70'
            }`}
          >
            {result.message}
          </div>
        )}
      </div>
    </main>
  );
}
