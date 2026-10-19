import Link from 'next/link';
import { inr, plans } from '@/lib/demo-data';

/** Public-facing preview of planned plans; billing is not enabled. */
export function PricingScreen() {
  return (
    <div className="pg">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">AutoDine</Link>
        <div className="pg__barLinks">
          <Link href="/#product">Product</Link>
          <Link href="/pricing" className="is-active">Pricing</Link>
          <Link href="/menu">Menu demo</Link>
        </div>
        <div className="pg__barRight">
          <Link href="/login" className="pg__barLink">Sign in</Link>
          <Link href="/signup" className="pg__barCta">Create account</Link>
        </div>
      </div>

      <div className="pg__body">
        <header className="pg__head">
          <div className="pg__kicker">Early preview</div>
          <h1 className="pg__title">Planned plans and pricing</h1>
          <p className="pg__lede">
            The prices below are planning figures, not an active offer. Billing, subscriptions and trial
            access are not enabled in this preview. No payment details are requested here.
          </p>
        </header>

        <section className="pg__plans" aria-label="Planned plans">
          {plans.map((plan) => (
            <article key={plan.id} className={`pg__plan ${plan.highlight ? 'is-featured' : ''}`}>
              {plan.highlight && <div className="pg__planFlag">Preview</div>}
              <div className="pg__planName">{plan.name}</div>
              <div className="pg__planPrice">
                {inr(plan.price)}<span>/month · planned</span>
              </div>
              <p className="pg__planBlurb">{plan.blurb}</p>
              <ul className="pg__planList">
                {plan.features.slice(0, 5).map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <Link href="/menu" className="pg__planBtn">Explore the menu demo</Link>
            </article>
          ))}
        </section>

        <div className="pg__note" role="note">
          <strong>Preview only.</strong> Features and plan entitlements are not yet available for purchase.
          Tax treatment and final prices require confirmation before billing launches.
        </div>

        <section className="pg__section" id="questions">
          <h2 className="pg__h2">Frequently asked</h2>
          <div className="pg__faqs">
            <details className="pg__faq">
              <summary>Can I place a real order or make a payment?</summary>
              <p>No. The menu, cart, kitchen and cashier flows currently use sample data. There is no live order or payment processing.</p>
            </details>
            <details className="pg__faq">
              <summary>Are these plan prices final?</summary>
              <p>No. They are planning figures shown for product preview only and do not represent an active subscription offer.</p>
            </details>
            <details className="pg__faq">
              <summary>Can I explore the customer menu?</summary>
              <p>Yes. The sample restaurant menu is available in the demo; its dishes, prices and restaurant details are fictional.</p>
            </details>
          </div>
        </section>

        <footer className="pg__foot">AutoDine · early product preview</footer>
      </div>
    </div>
  );
}
