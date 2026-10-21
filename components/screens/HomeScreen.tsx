import Image from 'next/image';
import Link from 'next/link';
import { inr, plans } from '@/lib/demo-data';
import { HomeMotion } from '@/components/HomeMotion';
import { HomeNavCondense } from '@/components/HomeNavCondense';

/* ============================================================================
   Editorial Minimal — locked design system
   Full-bleed photography, display typography, hairline rules, no shadows.
   ========================================================================== */
export function Home() {
  return (
    <div className="home">
      <nav className="home__nav">
        <Link href="/" className="home__brand">AutoDine</Link>
        <ul className="home__links">
          <li><a href="#product">Product</a></li>
          <li><Link href="/pricing">Pricing</Link></li>
          <li><Link href="/menu">Menu demo</Link></li>
        </ul>
        <div className="home__navRight">
          <Link href="/login" className="home__navLink">Sign in</Link>
          <Link href="/signup" className="home__navCta">Create account</Link>
        </div>
      </nav>

      <header className="home__hero" data-hero>
        <Image className="home__heroImg" src="/img/restaurant-interior.jpg" alt="Restaurant dining room at dusk" fill priority sizes="100vw" data-hero-image />
        <div className="home__heroShade" />
        <div className="home__heroBody" data-hero-body>
          <div className="home__kicker" data-anim="hero-kicker">Restaurant QR ordering &amp; management</div>
          <h1 className="home__h1" data-anim="hero-title">
            Every table,
            <br />
            one quiet system.
          </h1>
          <p className="home__lede" data-anim="hero-lede">
            A focused preview of the restaurant ordering experience we are building. Browse the sample menu and see how the customer, kitchen and counter screens fit together.
          </p>
          <div className="home__ctas" data-anim="hero-ctas">
            <Link href="/signup" className="home__btn home__btn--solid">Create account</Link>
            <Link href="/menu" className="home__btn home__btn--line">See the demo</Link>
          </div>
          <div className="home__note" data-anim="hero-note">Ordering is live · online payments and subscriptions are not enabled yet</div>
        </div>
      </header>

      <section className="home__section" id="product" data-anim="reveal">
        <div className="home__rule" data-rule />
        <div className="home__three" data-anim-group>
          {[
            ['01', 'A clear digital menu', 'Every dish, price and menu is edited and published from the dashboard, and several menus can run side by side — lunch and dinner, dine-in and takeaway.'],
            ['02', 'A connected service flow', 'A guest scans the table code, types the six digits showing inside the restaurant, and the order lands on the kitchen board immediately, spoken out in Hindi, and is paid for at the counter.'],
            ['03', 'Payments, designed carefully', 'Cash, card and UPI collected at the counter are recorded against the bill. No online payment provider is connected yet, so nothing is charged from a phone.'],
          ].map(([n, title, body]) => (
            <article key={n} className="home__col">
              <div className="home__num">{n}</div>
              <h3 className="home__colTitle">{title}</h3>
              <p className="home__colBody">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home__band" data-anim="reveal">
        <div className="home__bandInner" data-anim-group>
          {[
            ['Browser', 'No customer app install planned'],
            ['Table QR', 'Designed around table service'],
            ['Two paths', 'Online and counter payments planned'],
          ].map(([v, l]) => (
            <div key={l} className="home__stat">
              <div className="home__statValue">{v}</div>
              <div className="home__statLabel">{l}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="home__section" data-anim="reveal">
        <h2 className="home__h2">Plans</h2>
        <div className="home__plans" data-anim-group>
          {plans.map((p) => (
            <div key={p.id} className="home__plan">
              <div className="home__planName">{p.name}</div>
              <div className="home__planPrice">
                {inr(p.price)}<span>/month</span>
              </div>
              <p className="home__planBlurb">{p.blurb}</p>
              <ul className="home__planList">
                {p.features.slice(0, 5).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link href="/pricing" className="home__planLink">Preview {p.name} →</Link>
            </div>
          ))}
        </div>
        <p className="home__fine">
          Plan names, prices and features are illustrative preview content. Trials, subscriptions and billing
          are not enabled.
        </p>
      </section>

      <footer className="home__foot" data-anim="reveal">
        <Link href="/" className="home__footBrand">AutoDine</Link>
        <div className="home__footCols">
          <div>
            <div className="home__footTitle">Explore</div>
            <p><Link href="/#product">Product preview</Link> · <Link href="/pricing">Planned pricing</Link> · <Link href="/menu">Menu demo</Link></p>
          </div>
          <div>
            <div className="home__footTitle">Preview scope</div>
            <p>Sample restaurant content. No live orders, payment collection or subscriptions.</p>
          </div>
          <div>
            <div className="home__footTitle">Accounts</div>
            <p><Link href="/login">Sign in</Link> · <Link href="/signup">Create account</Link></p>
          </div>
        </div>
        <div className="home__footFine">AutoDine · Product preview · not for live restaurant operations</div>
      </footer>

      {/* Both render nothing. HomeNavCondense toggles the bar's condensed
          state on scroll; HomeMotion finds the [data-anim] elements above and
          animates them. See the failure modes documented in each. */}
      <HomeNavCondense />
      <HomeMotion />
    </div>
  );
}
