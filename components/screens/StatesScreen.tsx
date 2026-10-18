import Link from 'next/link';
import { inr, trial } from '@/lib/demo-data';
import { Skeleton } from '@/components/ui';

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
            The states most likely to be seen under pressure, worth judging now rather than after the build:
            pressure, so they are worth judging now rather than after the build.
          </p>
        </header>

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
              <p>Orders appear here the moment a guest scans a table QR and checks out.</p>
              <span className="pg__btn">Print QR cards</span>
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
              <span className="pg__btn">Retry now</span>
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
                <span className="pg__btn">View receipt</span>
                <span className="pg__btn">Print</span>
              </div>
            </div>
            <p className="pg__stateNote">Success states confirm what changed, not just that it worked.</p>
          </article>

          <article className="pg__stateCard">
            <div className="pg__stateLabel">Disabled</div>
            <div className="pg__stateBody">
              <div className="pg__fieldRow">
                <span className="pg__btn is-disabled">Publish menu</span>
                <span className="pg__btn is-disabled">Add table</span>
              </div>
              <p className="pg__stateNote pg__stateNote--top">
                Disabled controls keep a visible reason. Hover or helper text explains why instead of failing
                silently.
              </p>
            </div>
          </article>

          <article className="pg__stateCard">
            <div className="pg__stateLabel">Trial · {trial.remaining} days left</div>
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
                <span className="pg__btn pg__btn--solid">Choose a plan</span>
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
                      Nothing has been deleted. Your menus, orders, receipts and reports are all still here and
                      you can view and export them. New customer orders and paid features are switched off until
                      a plan is active.
                    </p>
                  </div>
                  <span className="pg__btn pg__btn--solid">Reactivate</span>
                </div>
                <div className="pg__lockedGrid">
                  <div>
                    <div className="pg__lockedLabel">Still available</div>
                    <ul>
                      <li>View menus, items and QR codes</li>
                      <li>View and export order history</li>
                      <li>View and reprint past receipts</li>
                      <li>View reports for the retained period</li>
                      <li>Manage your account and billing</li>
                    </ul>
                  </div>
                  <div>
                    <div className="pg__lockedLabel">Blocked on the server</div>
                    <ul>
                      <li>New customer orders</li>
                      <li>Online payments and counter payment recording</li>
                      <li>Menu publishing and AI imports</li>
                      <li>Creating or regenerating table QR codes</li>
                      <li>Voice announcements to the kitchen</li>
                    </ul>
                  </div>
                </div>
                <p className="pg__fine">
                  The “still available / blocked” split above is a proposal. It is enforced on the server, not
                  by hiding buttons — and I will confirm the exact list with you before building it.
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
                    <span className="pg__btn">Select</span>
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
