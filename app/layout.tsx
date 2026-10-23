import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoDine',
  description:
    'AutoDine — QR ordering and restaurant management for Indian restaurants. Scan, order, and the kitchen board hears it in Hindi. Online payments are not connected yet.',
  manifest: '/manifest.webmanifest',
  applicationName: 'AutoDine',
  /**
   * iOS reads this and nothing else: it ignores the manifest's icons, so the
   * home-screen icon on an iPhone comes from here or it is a grey screenshot
   * of the page. `appleWebApp` is what makes the launched app open without
   * Safari's chrome once it IS installed.
   */
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'AutoDine',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
};

/**
 * The viewport.
 *
 * `viewportFit: cover` is the one line that matters on a phone: without it
 * `env(safe-area-inset-*)` evaluates to 0 and the docked action bar sits
 * underneath the home indicator. The guest stylesheet already reserves space
 * for those insets in seven places -- they were simply never switched on.
 *
 * `maximumScale` is deliberately NOT set. Pinch-zoom stays available: a menu
 * with prices is exactly the kind of page somebody zooms, and disabling it to
 * make an app feel more native is an accessibility regression, not a feature.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f8f5ef',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Marks the document as "animation is safe to prepare for" before the
          first paint.

          The CSS only hides [data-anim] elements when <html> has .motion, and
          only this script adds that class. So if JavaScript is disabled or
          fails to run, the class is never added, nothing is ever hidden, and
          the page renders complete and readable. Equally, if the visitor has
          asked their OS for reduced motion, the class is withheld and no
          element is hidden or animated.

          It has to be inline and blocking: if it ran after paint, the browser
          would show the content first and then hide it to animate it back in,
          which is a visible flash.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var d=document.documentElement;" +
              "if(!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: no-preference)').matches))return;" +
              "d.classList.add('motion');" +
              // Fail open. The hiding rule is the only thing standing between a
              // visitor and a blank page, and it depends on a client component
              // mounting. If HomeMotion never reports in (a hydration error, a
              // chunk that 404s, an extension that blocks the bundle), dropping
              // .motion makes every staged element visible again -- un-animated,
              // but readable, which is the right way to lose.
              "setTimeout(function(){if(!d.hasAttribute('data-motion-ready'))d.classList.remove('motion')},4000)})()",
          }}
        />
      </head>
      <body>
        {/* [data-app] scopes every rule in styles/design-system.css to the product. */}
        {/* The cart is not mounted here any more. It is keyed by restaurant,
            so it belongs to the page that knows which restaurant this is --
            see the /menu routes. */}
        <div data-app>{children}</div>
      </body>
    </html>
  );
}
