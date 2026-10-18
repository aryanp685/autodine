import Link from 'next/link';
import { inr, plans, proposedLimits, faqs, trial } from '@/lib/demo-data';

/** Shared page structure; styled by the locked design system. */
export function PricingScreen() {
  return (
    <div className="pg">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">AutoDine</Link>
        <div className="pg__barLinks">
          <span>Product</span>
          <Link href="/pricing">Pricing</Link>
          <Link href="/menu">Demo</Link>
          <span>FAQs</span>
        </div>
        <div className="pg__barRight">
          <span className="pg__barLink">Sign in</span>
          <Link href="/signup" className="pg__barCta">Start 10-day trial</Link>
        </div>
      </div>

      <div className="pg__body">
        <header className="pg__head">
          <div className="pg__kicker">Plans</div>
          <h1 className="pg__title">Simple monthly pricing in rupees</h1>
          <p className="pg__lede">
            Every new account starts with a {trial.days}-day trial and all main features switched on. Nothing is
            deleted when the trial ends — if you choose not to subscribe, the account becomes read-only until
            you reactivate.
          </p>
        </header>

        <section className="pg__plans">
          {plans.map((p) => (
            <div key={p.id} className={`pg__plan ${p.highlight ? 'is-featured' : ''}`}>
              {p.highlight && <div className="pg__planFlag">Most chosen</div>}
              <div className="pg__planName">{p.name}</div>
              <div className="pg__planPrice">
                {inr(p.price)}
                <span>/month</span>
              </div>
              <p className="pg__planBlurb">{p.blurb}</p>
              <ul className="pg__planList">
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <span className="pg__planBtn">Choose {p.name}</span>
            </div>
          ))}
        </section>

        <div className="pg__note">
          <strong>Prices shown are monthly, in INR.</strong> The tax treatment and how it appears on your
          invoice have not been finalised; they will be stated clearly at checkout before any payment is taken.
        </div>

        <section className="pg__section">
          <h2 className="pg__h2">Plan limits — draft for approval</h2>
          <p className="pg__p">
            These numbers are a proposal, not a decision. Nothing is enforced yet, and I will not switch limits
            on without your sign-off. Anything marked with * still needs a financially sensible ceiling defined.
          </p>
          <table className="ui-table pg__table">
            <thead>
              <tr>
                <th>Limit</th>
                <th>Starter · {inr(899)}</th>
                <th>Professional · {inr(1599)}</th>
                <th>Business · {inr(2699)}</th>
              </tr>
            </thead>
            <tbody>
              {proposedLimits.map((l) => (
                <tr key={l.label}>
                  <td>{l.label}</td>
                  <td className="tnum">{l.starter}</td>
                  <td className="tnum">{l.professional}</td>
                  <td className="tnum">{l.business}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="pg__section">
          <h2 className="pg__h2">Trial &amp; subscription questions</h2>
          <div className="pg__faqs">
            {faqs.map((f) => (
              <details key={f.q} className="pg__faq">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <footer className="pg__foot">Prototype screen · prices are the locked values</footer>
      </div>
    </div>
  );
}
