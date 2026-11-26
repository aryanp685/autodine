/**
 * The choose-a-plan screen an owner meets the day the trial ends.
 *
 * Swagat Warmth, the same as sign-in: cream page, one card, the forest panel
 * with the waiter illustration beside it on a desktop. One decision here —
 * which plan to continue on — and the facts on the card are the catalog's:
 * the same PLANS the pricing page renders, no invented promises.
 *
 * Choosing a plan hands the owner to the subscription screen, which owns the
 * Cashfree checkout: this screen never pretends to take money.
 */

'use client';

import Link from 'next/link';
import { useState } from 'react';

import { AuthShell, authButtonClass } from '@/components/AuthShell';
import { AuthPendingBar } from '@/components/auth/AuthPendingBar';
import { BrandMark } from '@/components/BrandMark';
import { BILLING, PLANS } from '@/lib/plans';

const PERIOD_NOTE = 'Billed monthly, paid securely at checkout.';

export function ChoosePlanScreen({
  restaurantName,
  plan,
  daysRemaining,
}: {
  restaurantName: string;
  plan: string;
  daysRemaining: number;
}) {
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  async function choose(planId: string) {
    setBusyPlan(planId);
    // Hand the decision to the subscription screen, where the checkout lives.
    window.location.href = `/dashboard/subscription?plan=${encodeURIComponent(planId)}`;
  }

  const ended = daysRemaining <= 0;

  return (
    <AuthShell
      visual={
        <div>
          <p className="text-[10.5px] font-semibold tracking-[0.14em] text-white/60 uppercase">
            {restaurantName}
          </p>
          <p className="mt-2 text-[15px] leading-[1.6] text-white/85">
            {ended
              ? 'Your free days are done. Pick up from where your menu, tables and orders already are — nothing was deleted while you decided.'
              : `Your free run of everything ends in ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'}. Choose the plan you want to continue on.`}
          </p>
        </div>
      }
      eyebrow="AUTODINE · CONTINUE"
      title={ended ? 'Your 21 free days are complete' : 'Choose how you want to continue'}
      lede={
        ended
          ? 'Everything you built during the trial is saved. Choose a plan to open the doors again — your menu, tables and orders are exactly as you left them.'
          : `Pick the plan you want after the ${BILLING.trialDays}-day trial. You keep everything until the last free day either way.`
      }
      action={undefined}
      notesTitle="How billing works"
      notes={[
        <>
          The free trial runs <strong>{BILLING.trialDays} days</strong> with every feature on — no
          card needed, nothing to cancel.
        </>,
        <>
          After it, choose <strong>Starter</strong>, <strong>Professional</strong> or{' '}
          <strong>Business</strong>. {PERIOD_NOTE}
        </>,
        <>
          If you stop here, the account pauses: <strong>nothing is deleted</strong>, and signing
          back in with a plan brings it all back.
        </>,
      ]}
    >
      <ul className="m-0 flex list-none flex-col gap-3 p-0" data-choose-plans>
        {PLANS.map((p) => {
          const featured = p.id === plan;
          const busy = busyPlan === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => choose(p.id)}
                disabled={busyPlan !== null}
                aria-busy={busy}
                data-plan={p.id}
                className={`group w-full rounded-2xl border px-4 py-4 text-left transition-[border-color,background-color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--auth-accent-ink)] disabled:cursor-wait motion-reduce:transition-none ${
                  featured
                    ? 'border-[var(--auth-accent)]/55 bg-[var(--auth-accent)]/[0.06]'
                    : 'border-hair bg-white/70 hover:border-[var(--auth-accent)]/40'
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-[var(--auth-heading)]">
                    {p.name}
                    {featured ? (
                      <span className="ml-2 align-middle text-[10px] font-semibold tracking-[0.1em] text-[var(--auth-accent-ink)] uppercase">
                        trial plan
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[13.5px] font-semibold text-[var(--auth-heading)]">
                    ₹{p.price.toLocaleString('en-IN')}
                    <span className="text-[11px] font-medium text-gink-46">/mo</span>
                  </span>
                </span>
                <span className="mt-1 block text-[12px] leading-[1.55] text-gink-64">
                  {p.outlets === null ? 'Unlimited outlets' : `${p.outlets} ${p.outlets === 1 ? 'outlet' : 'outlets'}`} · {p.fit}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-5">
        {busyPlan ? (
          <>
            <AuthPendingBar />
            <span aria-live="polite" className={authButtonClass + ' w-full opacity-90'}>
              <span aria-hidden="true" className="auth-loading-logo">
                <BrandMark size={17} />
              </span>
              <span>Opening {PLANS.find((p) => p.id === busyPlan)?.name}…</span>
              <span aria-hidden="true" className="inline-flex w-4 shrink-0 justify-center">
                <span className="auth-loading-dots">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            </span>
          </>
        ) : (
          <p className="text-[11.5px] leading-[1.6] text-gink-46">
            Prices include everything in the plan — no setup fee. Checkout opens on the subscription
            page, and you can change your plan later.
          </p>
        )}
      </div>

      <p className="mt-5 border-t border-hair pt-4 text-[11.5px] text-gink-46">
        Questions first?{' '}
        <Link
          href="/pricing"
          className="font-medium text-[var(--auth-accent-ink)] underline-offset-4 transition-colors hover:text-[var(--auth-accent)] hover:underline"
        >
          Compare the plans
        </Link>{' '}
        or read the <Link href="/terms" className="underline underline-offset-4">terms</Link>.
      </p>
    </AuthShell>
  );
}
