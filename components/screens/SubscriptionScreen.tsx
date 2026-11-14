'use client';

/**
 * The owner's subscription.
 *
 * WHAT THIS SCREEN HAS TO GET RIGHT
 *
 * It is the page an owner reads when something has gone wrong with their
 * money, which is the worst moment to be vague. So it says, in this order:
 * is the account working, what does it cost, when does it end, and what
 * happens then. It never says "active" about a plan nobody has paid for, and
 * it never shows a Buy button that cannot work without also saying why.
 *
 * THREE STATES THAT LOOK ALIKE
 *
 *   trial running     everything works, and it stops on a date
 *   period ending     everything works, and it stops on a date
 *   payment failed    everything works, and it stops on a date
 *
 * All three are the same sentence with a different cause, and the cause is
 * printed. Only one of them is the owner's doing.
 *
 * Nothing here invents a price: every figure comes from the server's catalog.
 * Nothing here can switch a paid plan on: the action refuses while no payment
 * provider is configured, and the database refuses it from an authenticated
 * caller regardless.
 */

import Link from 'next/link';
import { useState } from 'react';

import { Notice, OwnerPage, PageHead, SectionHead, Tag, btn } from '@/components/owner/chrome';
import { SubmitButton } from '@/components/owner/SubmitButton';
import { formatBillMoney } from '@/lib/bill';
import { entitlementSummary } from '@/lib/access';
import { planName } from '@/lib/billing/catalog';
import { PROVIDER_UNAVAILABLE_MESSAGE } from '@/lib/billing/provider';
import {
  choosePlanAction,
  requestCancellationAction,
  retryPaymentAction,
  withdrawCancellationAction,
  type SubscriptionActionResult,
} from '@/lib/billing/actions';
import type { SubscriptionScreenData } from '@/lib/db/subscription-screen';
import type { OutletBar } from '@/lib/outlets';

/** "3 of 5 outlets", or "Unlimited outlets". Never says "null". */
function outletLine(data: SubscriptionScreenData): string {
  const state = data.state;
  if (!state) return 'Outlet usage is not available yet.';
  return entitlementSummary({
    used: state.outlets.used,
    limit: state.outlets.limit,
    unlimited: state.outlets.unlimited,
    remaining: state.outlets.remaining,
  });
}

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}

function whenWithTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** The heading under the plan name: what the owner is actually looking at. */
function statusLine(data: SubscriptionScreenData): string {
  const state = data.state;
  if (!state) return 'The subscription for this account has not been set up yet.';

  if (state.expired) {
    return 'This subscription has ended. Every outlet, menu, order and report is still here and still readable — nothing has been deleted. Choose a plan to start writing again.';
  }
  if (state.pastDue) {
    return 'The last payment did not go through. Everything keeps working until the end of the period; add a payment method or choose a plan to continue after that.';
  }
  if (state.status === 'cancel_requested') {
    return state.cancellation?.effectiveAt
      ? `Cancellation requested. Everything keeps working until ${when(state.cancellation.effectiveAt)}.`
      : 'Cancellation requested. Everything keeps working until the end of the period.';
  }
  if (state.trial.running) {
    return `Free trial · ${state.trial.daysRemaining} ${state.trial.daysRemaining === 1 ? 'day' : 'days'} left, until ${when(state.trial.endsAt)}. Every feature is switched on.`;
  }
  if (state.plan !== 'trial') {
    return state.period.expiresAt
      ? `${planName(state.plan)} · paid until ${when(state.period.expiresAt)}.`
      : `${planName(state.plan)} · no renewal date recorded yet.`;
  }
  return 'No plan is active on this account.';
}

export function SubscriptionScreen({
  data,
  outlet,
}: {
  data: SubscriptionScreenData;
  outlet: OutletBar | null;
}) {
  const [flash, setFlash] = useState<SubscriptionActionResult | null>(null);
  const state = data.state;
  // The subscription routes admit owners and managers. Plan changes, cancellation
  // and payment retries are owner-only; each Server Action repeats that check,
  // and the cancellation RPC independently enforces it in the database.
  const isOwner = data.role === 'owner';

  async function run(action: () => Promise<SubscriptionActionResult>) {
    setFlash(null);
    setFlash(await action());
  }

  return (
    <OwnerPage active="subscription" outlet={outlet} wide>
      <PageHead
        kicker="Account · subscription"
        title="Subscription"
        meta="One subscription covers every outlet on this account. Prices are monthly, in rupees, and nothing is charged until a payment provider is switched on."
      />

      {/* The state of the account, before anything else on the page. */}
      {state?.expired ? (
        <Notice tone="due" label="Subscription ended">
          {statusLine(data)}
        </Notice>
      ) : state?.pastDue ? (
        <Notice tone="due" label="Payment failed">
          {statusLine(data)}
          {state.lastPayment?.failureReason ? (
            <span className="mt-1 block text-gink-64">{state.lastPayment.failureReason}</span>
          ) : null}
          <div className="mt-3">
            {isOwner ? (
              <SubmitButton
                className={btn('solid', 'sm')}
                pendingLabel="Retrying…"
                onClick={() => run(retryPaymentAction)}
              >
                Retry payment
              </SubmitButton>
            ) : (
              <p className="text-[12.5px] leading-[1.6] text-gink-64">
                Only an owner of this account can retry a payment.
              </p>
            )}
          </div>
        </Notice>
      ) : state?.status === 'cancel_requested' ? (
        <Notice tone="due" label="Cancellation requested">
          {statusLine(data)}
          <div className="mt-3">
            {isOwner ? (
              <SubmitButton
                className={btn('ghost', 'sm')}
                pendingLabel="Withdrawing…"
                onClick={() => run(withdrawCancellationAction)}
              >
                Keep my subscription
              </SubmitButton>
            ) : (
              <p className="text-[12.5px] leading-[1.6] text-gink-64">
                Only an owner of this account can withdraw a cancellation request.
              </p>
            )}
          </div>
        </Notice>
      ) : state?.trial.running ? (
        <Notice tone="live" label="Free trial running">
          {statusLine(data)}
        </Notice>
      ) : (
        <Notice tone="plain" label={planName(state?.plan)}>
          {statusLine(data)}
        </Notice>
      )}

      {/* No provider: say it once, plainly, in the place an owner looks for a
          Buy button. This is not an error state; it is the current truth. */}
      {!data.providerConfigured ? (
        <Notice tone="plain" label="Online payment is not switched on">
          {PROVIDER_UNAVAILABLE_MESSAGE}
        </Notice>
      ) : null}

      {flash ? (
        <Notice tone={flash.ok ? 'live' : 'plain'} label={flash.ok ? 'Done' : 'Not now'}>
          {flash.message}
        </Notice>
      ) : null}

      <section className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]" aria-label="Current subscription">
        <div className="rounded-[14px] border border-hair bg-card p-5">
          <SectionHead title="This account" />
          <dl className="mt-4 space-y-3 text-[13px]">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-gink-64">Plan</dt>
              <dd className="font-medium">
                {planName(state?.plan)}
                {state?.status === 'trialing' ? <Tag tone="live">Trial</Tag> : null}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-gink-64">Price</dt>
              <dd className="font-medium">
                {state?.pricePaise != null ? `${formatBillMoney(state.pricePaise)} / month` : 'Free'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-gink-64">{state?.plan === 'trial' ? 'Trial ends' : 'Paid until'}</dt>
              <dd className="font-medium">
                {when(state?.plan === 'trial' ? state.trial.endsAt : state?.period.expiresAt)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-gink-64">Outlets</dt>
              <dd className="font-medium">{outletLine(data)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-gink-64">Writing</dt>
              <dd className="font-medium">
                {state?.canWrite ? 'Allowed' : 'Read-only until a plan is active'}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-[12.5px] leading-[1.6] text-gink-64">
            A downgrade or an expiry never removes an outlet, an order, a menu or a table. It stops
            new outlets from being created until the plan allows them again.
          </p>
        </div>

        <div className="rounded-[14px] border border-hair bg-card p-5">
          <SectionHead title="Choose a plan" meta={data.providerConfigured ? undefined : 'Prices are approved; online payment is not switched on yet.'} />
          <ul className="mt-4 space-y-3">
            {data.catalog.map((plan) => {
              const current = state?.plan === plan.id;
              return (
                <li
                  key={plan.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-hair px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[15px] font-medium">
                      {plan.name}
                      {current ? <Tag tone="live">Current</Tag> : null}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-gink-64">
                      {formatBillMoney(plan.paise)} / month ·{' '}
                      {plan.outlets === null ? 'Unlimited outlets' : `${plan.outlets} ${plan.outlets === 1 ? 'outlet' : 'outlets'}`}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-gink-46">{plan.fit}</p>
                  </div>
                  {current ? (
                    <span className="text-[12.5px] text-gink-64">On this plan</span>
                  ) : !isOwner ? (
                    <span className="text-[12.5px] text-gink-46">Owner only</span>
                  ) : (
                    <SubmitButton
                      className={btn('ghost', 'sm')}
                      pendingLabel="Checking…"
                      onClick={() => run(() => choosePlanAction(plan.id))}
                    >
                      {state?.plan === 'trial' ? `Choose ${plan.name}` : `Switch to ${plan.name}`}
                    </SubmitButton>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[12.5px] leading-[1.6] text-gink-64">
            Switching to a smaller plan is allowed at any time and deletes nothing. If the account
            already has more outlets than the smaller plan includes, creation stops at that number
            and every existing outlet keeps working.
          </p>
        </div>
      </section>

      <section className="mt-8" aria-label="Payment history">
        <SectionHead title="Payments" meta="Every payment attempt, successful or not, with its receipt." />
        {data.payments.length === 0 ? (
          <div className="rounded-[14px] border border-hair bg-card p-6">
            <p className="text-[13.5px] font-medium">No payments yet</p>
            <p className="mt-1.5 text-[12.5px] text-gink-64">
              Nothing has been charged. Payments and their receipts appear here once a payment
              provider is switched on.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[14px] border border-hair bg-card">
            <table className="w-full min-w-[720px] border-collapse text-left text-[12.5px]">
              <thead className="border-b border-hair text-[10px] font-semibold tracking-[0.1em] text-gink-46 uppercase">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-hair last:border-0">
                    <td className="px-4 py-3 text-gink-64">{whenWithTime(payment.paidAt)}</td>
                    <td className="px-4 py-3 font-medium">{payment.planLabel}</td>
                    <td className="px-4 py-3 text-gink-64">
                      {payment.periodStart ? `${when(payment.periodStart)} – ${when(payment.periodEnd)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatBillMoney(payment.amountPaise)}
                    </td>
                    <td className="px-4 py-3">
                      <Tag tone={payment.status === 'succeeded' ? 'live' : payment.status === 'failed' ? 'due' : 'neutral'}>
                        {payment.status}
                      </Tag>
                      {payment.failureReason ? (
                        <span className="mt-1 block text-gink-64">{payment.failureReason}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {payment.receiptId && payment.receipt ? (
                        <Link
                          className="underline decoration-hair-strong underline-offset-2"
                          href={`/dashboard/subscription/receipt/${payment.receiptId}`}
                        >
                          {payment.receipt}
                        </Link>
                      ) : (
                        <span className="text-gink-46">No receipt</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8" aria-label="Subscription history">
        <SectionHead title="Subscription history" meta="What changed, when, and who or what changed it." />
        {data.history.length === 0 ? (
          <div className="rounded-[14px] border border-hair bg-card p-6">
            <p className="text-[13.5px] font-medium">Nothing has changed yet</p>
            <p className="mt-1.5 text-[12.5px] text-gink-64">
              Trial activation, plan changes, payments, cancellations and expiries are listed here.
            </p>
          </div>
        ) : (
          <ol className="rounded-[14px] border border-hair bg-card">
            {data.history.map((event) => (
              <li key={event.id} className="border-b border-hair px-5 py-4 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-[13.5px] font-medium">{historyTitle(event.kind, event)}</p>
                  <p className="text-[12.5px] text-gink-46">{whenWithTime(event.occurredAt)}</p>
                </div>
                {event.note ? (
                  <p className="mt-1 text-[12.5px] leading-[1.6] text-gink-64">{event.note}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8 rounded-[14px] border border-hair bg-card p-5" aria-label="Cancellation">
        <SectionHead title="Cancel the subscription" />
        <p className="mt-3 text-[12.5px] leading-[1.6] text-gink-64">
          Cancelling stops the next renewal. It does not close the account, and it does not delete
          an outlet, an order, a menu or a table: on the effective date every outlet becomes
          read-only and every row stays readable.
        </p>
        {!isOwner ? (
          <p className="mt-4 text-[12.5px] leading-[1.6] text-gink-64">
            Only an owner of this account can change or cancel the plan. You can see everything
            about it here.
          </p>
        ) : state?.cancellation ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-[13px]">
              {state.cancellation.confirmed ? 'Cancelled' : 'Cancellation requested'} · effective{' '}
              {when(state.cancellation.effectiveAt)}
            </p>
            {!state.cancellation.confirmed ? (
              <SubmitButton
                className={btn('ghost', 'sm')}
                pendingLabel="Withdrawing…"
                onClick={() => run(withdrawCancellationAction)}
              >
                Keep my subscription
              </SubmitButton>
            ) : null}
          </div>
        ) : (
          <div className="mt-4">
            <SubmitButton
              className={btn('ghost', 'sm')}
              pendingLabel="Requesting…"
              onClick={() => run(requestCancellationAction)}
            >
              Request cancellation
            </SubmitButton>
          </div>
        )}
      </section>
    </OwnerPage>
  );
}

/** One line of history, in the owner's words rather than an enum's. */
function historyTitle(
  kind: string,
  event: { fromPlan?: string | null; toPlan?: string | null; amountPaise?: number | null; actor?: string; note?: string | null },
): string {
  const money = event.amountPaise ? ` · ${formatBillMoney(event.amountPaise)}` : '';
  switch (kind) {
    case 'trial_granted':
      return 'Trial started';
    case 'trial_denied':
      return 'Trial not available';
    case 'trial_extended':
      return 'Trial extended to 21 days';
    case 'plan_changed':
      return `Plan changed${event.fromPlan ? ` from ${planName(event.fromPlan)}` : ''} to ${planName(event.toPlan)}`;
    case 'renewed':
      return `Renewed${event.toPlan ? ` on ${planName(event.toPlan)}` : ''}${money}`;
    case 'payment_succeeded':
      return `Payment received${money}`;
    case 'payment_failed':
      return `Payment failed${money}`;
    case 'cancellation_requested':
      return 'Cancellation requested';
    case 'cancellation_withdrawn':
      return 'Cancellation withdrawn';
    case 'cancellation_confirmed':
      return 'Cancellation confirmed';
    case 'expired':
      return 'Subscription ended';
    case 'provider_unavailable':
      return 'Payment provider not available';
    default:
      return kind;
  }
}
