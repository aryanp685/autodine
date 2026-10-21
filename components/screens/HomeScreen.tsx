import Image from 'next/image';
import Link from 'next/link';
import { inr, plans } from '@/lib/demo-data';

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

      <header className="home__hero">
        <Image className="home__heroImg" src="/img/restaurant-interior.jpg" alt="Restaurant dining room at dusk" fill priority sizes="100vw" />
        <div className="home__heroShade" />
        <div className="home__heroBody">
          <div className="home__kicker">Restaurant QR ordering &amp; management</div>
          <h1 className="home__h1">
            Every table,
            <br />
            one quiet system.
          </h1>
          <p className="home__lede">
            A focused preview of the restaurant ordering experience we are building. Browse the sample menu and explore prototypes for the customer, kitchen and counter screens.
          </p>
          <div className="home__ctas">
            <Link href="/signup" className="home__btn home__btn--solid">Create account</Link>
            <Link href="/menu" className="home__btn home__btn--line">See the demo</Link>
          </div>
          <div className="home__note">Preview only · a connected, accessible test workspace can accept unpaid counter orders. Online payments and subscriptions are not enabled, and the hosted order-to-kitchen flow is not production-verified.</div>
        </div>
      </header>

      <section className="home__section" id="product">
        <div className="home__rule" />
        <div className="home__three">
          {[
            ['01', 'A clear digital menu', 'Explore a sample menu or read a published restaurant menu when configured. Menu editing and publishing are still previews.'],
            ['02', 'A connected service flow', 'QR checkout can save unpaid counter orders in a connected test workspace. The live kitchen board and hosted end-to-end workflow are not yet verified.'],
            ['03', 'Payments, designed carefully', 'Online payments are not connected. Cash recording exists in an early cashier path, but is not live-verified.'],
          ].map(([n, title, body]) => (
            <article key={n} className="home__col">
              <div className="home__num">{n}</div>
              <h3 className="home__colTitle">{title}</h3>
              <p className="home__colBody">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home__band">
        <div className="home__bandInner">
          {[
            ['Browser', 'No customer app install planned'],
            ['Table QR', 'Designed around table service'],
            ['Two paths', 'Guest online payment planned · cashier cash path unverified'],
          ].map(([v, l]) => (
            <div key={l} className="home__stat">
              <div className="home__statValue">{v}</div>
              <div className="home__statLabel">{l}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="home__section">
        <h2 className="home__h2">Plans</h2>
        <div className="home__plans">
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

      <footer className="home__foot">
        <Link href="/" className="home__footBrand">AutoDine</Link>
        <div className="home__footCols">
          <div>
            <div className="home__footTitle">Explore</div>
            <p><Link href="/#product">Product preview</Link> · <Link href="/pricing">Planned pricing</Link> · <Link href="/menu">Menu demo</Link></p>
          </div>
          <div>
            <div className="home__footTitle">Preview scope</div>
            <p>Demo content contains no live orders or subscriptions. QR orders and cash collection are early test paths; the live kitchen workflow is not verified.</p>
          </div>
          <div>
            <div className="home__footTitle">Accounts</div>
            <p><Link href="/login">Sign in</Link> · <Link href="/signup">Create account</Link></p>
          </div>
        </div>
        <div className="home__footFine">AutoDine · Product preview · not for live restaurant operations</div>
      </footer>
    </div>
  );
}
