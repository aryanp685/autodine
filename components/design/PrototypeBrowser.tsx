'use client';

import { useState } from 'react';

const SCREENS = [
  { group: 'Public', name: 'Home', path: '/' },
  { group: 'Public', name: 'Sign in', path: '/login' },
  { group: 'Public', name: 'Create account', path: '/signup' },
  { group: 'Owner workspace', name: 'Overview', path: '/dashboard' },
  { group: 'Owner workspace', name: 'Menu editor', path: '/dashboard/menus' },
  { group: 'Owner workspace', name: 'Tables & QR', path: '/dashboard/tables' },
  { group: 'Customer', name: 'Digital menu', path: '/menu' },
  { group: 'Customer', name: 'Item customization', path: '/menu/item?item=it-butter-chicken' },
  { group: 'Customer', name: 'Cart', path: '/menu/cart' },
  { group: 'Customer', name: 'Checkout preview', path: '/menu/checkout' },
  { group: 'Operations', name: 'Kitchen', path: '/kitchen' },
  { group: 'Operations', name: 'Cashier', path: '/cashier' },
  { group: 'Plans', name: 'Planned pricing', path: '/pricing' },
];

type Viewport = 'desktop' | 'mobile';

export function PrototypeBrowser() {
  const [selectedPath, setSelectedPath] = useState(SCREENS[0].path);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const selected = SCREENS.find((screen) => screen.path === selectedPath) ?? SCREENS[0];
  const groups = [...new Set(SCREENS.map((screen) => screen.group))];

  return (
    <main className="design-review">
      <header className="design-review__topbar">
        <a className="design-review__brand" href="/">AutoDine<span>.</span></a>
        <div className="design-review__topMeta">
          <span className="design-review__statusDot" />
          <span>Design review · demo content only</span>
        </div>
      </header>

      <div className="design-review__layout">
        <aside className="design-review__sidebar" aria-label="Screen inventory">
          <div className="design-review__sideIntro">
            <div className="design-review__eyebrow">Phase 1 · UI inventory</div>
            <h1>One product.<br />Every service moment.</h1>
            <p>Browse the existing Editorial Minimal direction across representative screens and viewport sizes.</p>
          </div>
          <nav className="design-review__nav">
            {groups.map((group) => (
              <section className="design-review__navGroup" key={group}>
                <h2>{group}</h2>
                {SCREENS.filter((screen) => screen.group === group).map((screen) => (
                  <button
                    key={screen.path}
                    type="button"
                    className={`design-review__navItem ${selectedPath === screen.path ? 'is-active' : ''}`}
                    aria-current={selectedPath === screen.path ? 'page' : undefined}
                    onClick={() => setSelectedPath(screen.path)}
                  >
                    <span>{screen.name}</span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </section>
            ))}
          </nav>
          <p className="design-review__sidebarNote">
            Scope note: working controls stay within their approved capabilities. Demo actions do not write to a restaurant database.
          </p>
        </aside>

        <section className="design-review__workspace" aria-label={`${selected.name} prototype`}>
          <div className="design-review__heading">
            <div>
              <div className="design-review__eyebrow">{selected.group} · current approved direction</div>
              <h2>{selected.name}</h2>
            </div>
            <div className="design-review__toolbar">
              <div className="design-review__segmented" aria-label="Choose preview size">
                <button
                  type="button"
                  aria-pressed={viewport === 'desktop'}
                  className={viewport === 'desktop' ? 'is-active' : ''}
                  onClick={() => setViewport('desktop')}
                >Desktop</button>
                <button
                  type="button"
                  aria-pressed={viewport === 'mobile'}
                  className={viewport === 'mobile' ? 'is-active' : ''}
                  onClick={() => setViewport('mobile')}
                >Mobile</button>
              </div>
              <a className="design-review__openLink" href={selected.path} target="_blank" rel="noreferrer">Open screen ↗</a>
            </div>
          </div>

          <div className={`design-review__stage design-review__stage--${viewport}`}>
            <div className={`design-review__device design-review__device--${viewport}`}>
              <iframe
                key={`${selected.path}-${viewport}`}
                title={`${selected.name} ${viewport} preview`}
                src={selected.path}
                loading="lazy"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
          <footer className="design-review__footnote">
            Existing UI preview—not a second visual direction and not a live Supabase acceptance test. Some protected workspace screens may request sign-in when Supabase is configured.
          </footer>
        </section>
      </div>
    </main>
  );
}
