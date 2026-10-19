import Link from 'next/link';
import { inr, trial } from '@/lib/demo-data';
import { Skeleton } from '@/components/ui';
import { PreviewAction } from '@/components/ui/PreviewAction';

/** Shared page structure; styled by the locked design system. */
export function StatesScreen() {
  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">AutoDine</Link>
        <div className="pg__barLinks">
          <Link href="/dashboard" className="is-active">
            Overview
          </Link>
          <Link href="/dashboard/menus">Menus</Link>
          <Link href="/dashboard/tables">Tables &amp; QR</Link>
          <span>Orders</span>
        </div>
        <div className="pg__barRight">
          <span className="pg__avatar">AP</span>
        </div>
      </div>

      <div className="pg__body">
        <header className="pg__head">
          <div className="pg__kicker">Cross-cutting</div>
          <h1 className="pg__title">States, trial &amp; subscription</h1>
          <p className="pg__lede">
            Illustrative loading, error, success and trial states for product review. This screen does not read a live workspace or account entitlement.
          </p>
        </header>
        <div className="pg__demoBanner"><strong>Demo state examples.</strong> These messages and dates are illustrative, not live account or order data.</div>

        <section className="pg__states">
          <article className="pg__stateCard">
            <div className="pg__stateLabel">Loading</div>
            <div className="pg__stateBody">
              <Skeleton w="60%" h={14} />
              <Skeleton w="90%" h={10} />
              <Skeleton w="40%" h={10} />
            </div>
            <p className="pg__stateNote">Skeletons match the final layout to avoid content jumping.</p>
          </article>

          <article className="pg__stateCard">
            <div className="pg__stateLabel">Empty</div>
            <div className="pg__stateBody pg__stateBody--center">
              <div className="pg__stateIcon">🍽️</div>
              <strong>No orders yet today</strong>
              <p>In a future guest-order flow, orders would appear here after checkout. Guest ordering is not connected yet.</p>
              <PreviewAction className="pg__btn" message="This state screen has sample data only; visit Tables & QR for the printable demo sheet.">Print QR cards</PreviewAction>
            </div>
            <p className="pg__stateNote">Empty states explain the next action, not just the absence.</p>
          </article>

          <article className="pg__stateCard">
            <div className="pg__stateLabel">Error</div>
            <div className="pg__stateBody">
              <div className="pg__alert">
                <strong>Could not reach the kitchen board</strong>
                <p>Your orders are safe. Reconnecting automatically…</p>
              </div>
              <PreviewAction className="pg__btn" message="This is a static error-state example; no live request is pending to retry.">Retry now</PreviewAction>
            </div>
            <p className="pg__stateNote">Errors never imply data loss when the order is already saved.</p>
          </article>

          <article className="pg__stateCard">
            <div className="pg__stateLabel">Success</div>
            <div className="pg__stateBody">
              <div className="pg__success">
                <strong>✓ Payment recorded</strong>
                <p>Order A-1041 is now paid. Receipt R-2041 is ready.</p>
              </div>
              <div className="pg__stateActions">
                <PreviewAction className="pg__btn" message="Receipts are not implemented in this preview.">View receipt</PreviewAction>
                <PreviewAction className="pg__btn" message="This is sample payment data; no receipt can be printed.">Print</PreviewAction>
              </div>
            </div>
            <p className="pg__stateNote">Success states confirm what changed, not just that it worked.</p>
          </article>

          <article className="pg__stateCard">
            <div className="pg__stateLabel">Disabled</div>
            <div className="pg__stateBody">
              <div className="pg__fieldRow">
                <PreviewAction className="pg__btn" message="Publishing is not available until live menu writes are implemented and verified.">Publish menu</PreviewAction>
                <PreviewAction className="pg__btn" message="Table creation is not available in this preview.">Add table</PreviewAction>
              </div>
              <p className="pg__stateNote pg__stateNote--top">
                Disabled controls keep a visible reason. Hover or helper text explains why instead of failing
                silently.
              </p>
            </div>
          </article>

          <article className="pg__stateCard">
            <div className="pg__stateLabel">Demo trial example · {trial.remaining} days left</div>
            <div className="pg__stateBody">
              <div className="pg__trialBox">
                <div className="ui-spread">
                  <strong>Free trial</strong>
                  <span className="tnum">
                    {trial.started} → {trial.expires}
                  </span>
                </div>
                <div className="ui-progress">
                  <i style={{ width: '40%' }} />
                </div>
                <p className="pg__trialMeta">
                  {trial.reminderShown}. All features are open right now.
                </p>
                <PreviewAction className="pg__btn pg__btn--solid" message="Plan selection is illustrative; billing is not enabled.">Choose a plan</PreviewAction>
              </div>
            </div>
          </article>

          <article className="pg__stateCard pg__stateCard--wide">
            <div className="pg__stateLabel">Trial expired · read-only mode</div>
            <div className="pg__stateBody">
              <div className="pg__locked">
                <div className="pg__lockedHead">
                  <span className="pg__lockedIcon">🔒</span>
                  <div>
                    <strong>Your trial ended on {trial.expires}</strong>
                    <p>
                      This example shows the intended read-only state. The database gate preserves existing rows
                      and blocks restaurant writes after expiry; live export, receipts, reports and billing UI are
                      not connected here.
                    </p>
                  </div>
                  <PreviewAction className="pg__btn pg__btn--solid" message="Billing/reactivation is not configured; this action made no account changes.">Reactivate</PreviewAction>
                </div>
                <div className="pg__lockedGrid">
                  <div>
                    <div className="pg__lockedLabel">Intended to remain readable</div>
                    <ul>
                      <li>Restaurant data allowed by membership read policies</li>
                      <li>Restaurant-data gate does not restrict Auth account-recovery actions</li>
                      <li>Existing rows remain in the database after expiry</li>
                      <li>Export, receipt and report screens are not implemented</li>
                    </ul>
                  </div>
                  <div>
                    <div className="pg__lockedLabel">Restaurant writes blocked by the trial gate</div>
                    <ul>
                      <li>New guest and counter orders</li>
                      <li>Cash payment collection</li>
                      <li>Menu, category, item and variant writes</li>
                      <li>Dining-table and QR-token writes</li>
                      <li>Restaurant settings and kitchen-status writes</li>
                    </ul>
                  </div>
                </div>
                <p className="pg__fine">
                  The 10-day server-side write gate is present in migration 0003, but these panels are examples—not
                  live entitlement or billing screens. Local tests do not replace verification against Supabase.
                </p>
              </div>
            </div>
          </article>

          <article className="pg__stateCard pg__stateCard--wide">
            <div className="pg__stateLabel">Plan selection</div>
            <div className="pg__stateBody">
              <div className="pg__planRow">
                {[
                  ['Starter', 899, 'Single restaurant essentials'],
                  ['Professional', 1599, 'AI import, deeper reports, more staff'],
                  ['Business', 2699, 'Multi-device kitchens and cashier teams'],
                ].map(([name, price, blurb]) => (
                  <div key={name as string} className="pg__planMini">
                    <strong>{name}</strong>
                    <div className="pg__planMiniPrice tnum">{inr(price as number)}/mo</div>
                    <p>{blurb}</p>
                    <PreviewAction className="pg__btn" message={`${name} is a planning option; no subscription was selected.`}>Select</PreviewAction>
                  </div>
                ))}
              </div>
              <p className="pg__fine">
                Plan prices are the locked values. Tax treatment is still to be decided and will be shown before
                any payment step.
              </p>
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}
