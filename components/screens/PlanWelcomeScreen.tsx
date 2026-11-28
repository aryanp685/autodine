'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { BtnLink, Notice, OwnerPage, Tag, btn } from '@/components/owner/chrome';
import { OpsSurface } from '@/components/owner/OpsSurface';
import { formatBillMoney } from '@/lib/bill';
import type { PlanPrice } from '@/lib/billing/catalog';
import type { SubscriptionScreenData } from '@/lib/db/subscription-screen';
import type { OutletBar } from '@/lib/outlets';
import { capabilitiesFor } from '@/lib/plans';

/**
 * The screen a buyer sees when Cashfree sends them back.
 *
 * WHAT IT MUST NOT DO
 *
 * It must never congratulate somebody whose payment has not landed. The plan
 * is granted by the webhook (app/api/billing/webhook), which usually arrives a
 * few seconds after the browser: while this screen cannot see the plan active
 * it says "confirming", polls the server, and only then switches to the
 * welcome. If the confirmation never arrives it says so plainly instead of
 * inventing a success.
 *
 * WHAT IT SHOWS
 *
 * The plan, what it costs, until when it is paid, the receipt, and the
 * features that are actually live for it — read from lib/plans, never typed
 * out here. Planned-but-not-built capabilities stay off this screen: a buyer
 * reading them as delivered would be misled.
 */

const CONFIRM_POLL_MS = 3000;
/** One minute of polling, then the honest "still confirming" panel. */
const CONFIRM_ATTEMPTS = 20;

const NEXT_STEPS = [
  {
    href: '/dashboard/menus',
    title: 'Add your menu',
    detail: 'Sections, dishes and prices — publish when it reads right.',
  },
  {
    href: '/dashboard/tables',
    title: 'Print your table cards',
    detail: 'One card per table, each with its own rotating code.',
  },
  {
    href: '/dashboard',
    title: 'See today at a glance',
    detail: 'Takings, live orders and the kitchen queue on one screen.',
  },
];

function money(paise: number): string {
  return formatBillMoney(paise);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "28 Dec 2026", computed rather than formatted.
 *
 * Intl.DateTimeFormat output can differ between the Node render and the
 * browser hydration (React then reports a mismatch and keeps the server text),
 * so the restaurant's day is derived from the IST offset by hand.
 */
function day(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const ist = new Date(parsed + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

export function PlanWelcomeScreen({
  plan,
  data,
  outlet,
}: {
  plan: PlanPrice;
  data: SubscriptionScreenData;
  outlet: OutletBar | null;
}) {
  const router = useRouter();
  const state = data.state;
  const activated = Boolean(state && !state.expired && state.plan === plan.id);
  const [checks, setChecks] = useState(0);
  const waiting = !activated;
  const givenUp = waiting && checks >= CONFIRM_ATTEMPTS;

  useEffect(() => {
    if (activated || checks >= CONFIRM_ATTEMPTS) return;
    const timer = window.setTimeout(() => {
      setChecks((count) => count + 1);
      router.refresh();
    }, CONFIRM_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [activated, checks, router]);

  const features = useMemo(
    () => capabilitiesFor(plan.id).filter((capability) => capability.state === 'live'),
    [plan.id]
  );

  const paidUntil = day(state?.period.endsAt ?? state?.period.expiresAt ?? null);
  const receipt = state?.lastPayment?.receipt ?? null;
  const paid = state?.lastPayment?.status === 'succeeded' ? state.lastPayment.amountPaise : plan.paise;
  const outletsLine =
    plan.outlets === null ? 'Unlimited outlets' : `${plan.outlets} ${plan.outlets === 1 ? 'outlet' : 'outlets'}`;

  return (
    <OwnerPage active="subscription" outlet={outlet} wide>
      <OpsSurface tone="welcome">
        <div className="mx-auto w-full max-w-[980px]">
          <section
            aria-label="Plan confirmation"
            className="rounded-[var(--p-r-card)] border border-[var(--p-line-soft)] bg-[var(--p-card)] px-5 py-7 shadow-[var(--p-shadow-1)] sm:px-8 sm:py-9"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Tag tone={activated ? 'live' : 'work'}>
                {activated ? 'Payment confirmed' : 'Confirming payment'}
              </Tag>
              <span className="text-[10.5px] font-semibold tracking-[0.18em] text-[var(--p-ink-46)] uppercase">
                {plan.name} · {money(plan.paise)} a month
              </span>
            </div>

            <h1 className="ov-display mt-4 text-[clamp(1.75rem,3.2vw,2.5rem)] leading-[1.1] font-normal text-[var(--p-ink)]">
              {activated ? `You're on ${plan.name}.` : 'Almost there.'}
            </h1>

            <p
              aria-live="polite"
              className="mt-3 max-w-[62ch] text-[13.5px] leading-relaxed text-[var(--p-ink-80)]"
            >
              {activated
                ? `${money(paid)} went through${paidUntil ? ` and this account is paid up to ${paidUntil}` : ''}. Everything below is switched on from right now.`
                : `Cashfree has brought you back here, and we are waiting for their payment confirmation. It usually takes a few seconds — this page checks on its own, nothing to press.`}
            </p>

            {activated ? (
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <BtnLink href="/dashboard" tone="accent">
                  Open the dashboard
                </BtnLink>
                <BtnLink href="/dashboard/subscription" tone="ghost">
                  Plan and payments
                </BtnLink>
              </div>
            ) : (
              <ol className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Payment progress">
                <Step index="01" label="Payment made" detail="Cashfree took you through checkout." done />
                <Step
                  index="02"
                  label="Confirmation"
                  detail={givenUp ? 'Not received yet.' : 'Cashfree is telling us now.'}
                  current={!givenUp}
                />
                <Step index="03" label="Plan active" detail="Switches on by itself." />
              </ol>
            )}
          </section>

          {givenUp ? (
            <div className="mt-4">
              <Notice tone="due" label="Not confirmed yet">
                <span className="block text-[13px] leading-relaxed">
                  No confirmation has reached us for a {plan.name} purchase on this account. If
                  the money left your account it is not lost — confirmation sometimes takes a
                  minute. Check again below; nothing is ever charged twice.
                </span>
                <span className="mt-3 flex flex-wrap gap-2.5">
                  <button type="button" className={btn('accent', 'sm')} onClick={() => setChecks(0)}>
                    Check again
                  </button>
                  <BtnLink href="/dashboard/subscription" tone="ghost" size="sm">
                    Subscription
                  </BtnLink>
                </span>
              </Notice>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
            <section
              aria-label={`What ${plan.name} includes`}
              className="rounded-[var(--p-r-card)] border border-[var(--p-line-soft)] bg-[var(--p-card)] px-5 py-6 shadow-[var(--p-shadow-1)] sm:px-7"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[13px] font-semibold tracking-[0.01em] text-[var(--p-ink)]">
                  What you just switched on
                </h2>
                <span className="text-[10.5px] font-semibold tracking-[0.14em] text-[var(--p-ink-46)] uppercase">
                  {features.length} features
                </span>
              </div>
              <ul className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <li className="flex gap-3">
                  <Check />
                  <span>
                    <span className="block text-[13px] font-medium text-[var(--p-ink)]">{outletsLine}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-[var(--p-ink-64)]">
                      {plan.fit}
                    </span>
                  </span>
                </li>
                {features.map((capability) => (
                  <li key={capability.id} className="flex gap-3">
                    <Check />
                    <span>
                      <span className="block text-[13px] font-medium text-[var(--p-ink)]">
                        {capability.label}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-relaxed text-[var(--p-ink-64)]">
                        {capability.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section
              aria-label="Your plan"
              className="rounded-[var(--p-r-card)] border border-[var(--p-line-soft)] bg-[var(--p-card)] px-5 py-6 shadow-[var(--p-shadow-1)] sm:px-6"
            >
              <h2 className="text-[13px] font-semibold tracking-[0.01em] text-[var(--p-ink)]">Your plan</h2>
              <dl className="mt-4 space-y-3">
                <Row label="Plan" value={plan.name} />
                <Row label="Price" value={`${money(plan.paise)} / month`} />
                <Row label="Paid until" value={activated ? (paidUntil ?? 'Confirmed') : 'Pending confirmation'} />
                <Row label="Outlets" value={outletsLine} />
                {receipt ? <Row label="Receipt" value={receipt} /> : null}
              </dl>
              <p className="mt-4 border-t border-[var(--p-line-soft)] pt-3 text-[11.5px] leading-relaxed text-[var(--p-ink-46)]">
                Monthly, through Cashfree. Cancel any time from the subscription screen — your
                data stays.
              </p>
            </section>
          </div>

          <section aria-label="Next steps" className="mt-4">
            <h2 className="px-1 text-[10.5px] font-semibold tracking-[0.18em] text-[var(--p-ink-46)] uppercase">
              Where to start
            </h2>
            <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
              {NEXT_STEPS.map((step, index) => (
                <Link
                  key={step.href}
                  href={step.href}
                  className="group flex min-h-11 flex-col gap-1 rounded-[var(--p-r-card)] border border-[var(--p-line-soft)] bg-[var(--p-card)] px-5 py-4 no-underline shadow-[var(--p-shadow-1)] transition-colors duration-150 hover:bg-[var(--p-paper)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--p-accent)]"
                >
                  <span className="text-[10.5px] font-semibold tracking-[0.16em] text-[var(--p-accent-strong)]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[13.5px] font-medium text-[var(--p-ink)]">{step.title}</span>
                  <span className="text-[12.5px] leading-relaxed text-[var(--p-ink-64)]">{step.detail}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </OpsSurface>
    </OwnerPage>
  );
}

function Check() {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--p-accent-soft)] text-[var(--p-accent-ink)]"
    >
      <svg viewBox="0 0 20 20" className="size-3" aria-hidden="true">
        <path
          d="M4.5 10.5 8 14 15.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Step({
  index,
  label,
  detail,
  done = false,
  current = false,
}: {
  index: string;
  label: string;
  detail: string;
  done?: boolean;
  current?: boolean;
}) {
  return (
    <li className="rounded-[14px] border border-[var(--p-line-soft)] bg-[var(--p-paper)] px-4 py-3">
      <span className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.16em] uppercase">
        <span
          className={
            done || current
              ? 'text-[var(--p-accent-strong)]'
              : 'text-[var(--p-ink-46)]'
          }
        >
          {index}
        </span>
        <span className={done || current ? 'text-[var(--p-ink)]' : 'text-[var(--p-ink-46)]'}>{label}</span>
        {current ? (
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-[var(--p-accent)] motion-safe:animate-pulse"
          />
        ) : null}
      </span>
      <span className="mt-1 block text-[12.5px] leading-relaxed text-[var(--p-ink-64)]">{detail}</span>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11.5px] text-[var(--p-ink-46)]">{label}</dt>
      <dd className="text-right text-[13px] font-medium text-[var(--p-ink)]">{value}</dd>
    </div>
  );
}
