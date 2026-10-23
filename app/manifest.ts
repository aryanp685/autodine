import type { MetadataRoute } from 'next';

/**
 * The web app manifest.
 *
 * WHY THIS EXISTS
 *
 * The guest flow is already shaped like an app -- full-screen steps, one
 * docked action, no page chrome -- but a phone had no way to keep it. There
 * was no manifest and no viewport export, so "Add to Home Screen" produced a
 * bookmark that opened the browser, with the address bar eating 56px of a
 * 390px screen. This is what turns the same URL into an installed app: its own
 * icon, its own splash, and the full viewport.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *  - No service worker. An offline cache is a second copy of a menu that can
 *    go stale while the kitchen is still cooking, and the QR flow is worthless
 *    without a live table session anyway. Installability does not require one.
 *  - `start_url` is `/menu`, because the reason a guest installs this is the
 *    menu. It carries no slug: the app then says which card to scan, which is
 *    honest, rather than remembering the last restaurant and showing it to a
 *    guest sitting somewhere else.
 *  - No `scope` gymnastics: the whole origin is one product.
 */
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AutoDine',
    short_name: 'AutoDine',
    description: 'Scan the table, order from the menu, follow it to the table.',
    start_url: '/menu',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8f5ef',
    // Matches --p-paper so the status bar blends into the page instead of
    // drawing a black band above a cream menu.
    theme_color: '#f8f5ef',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Your cart',
        short_name: 'Cart',
        url: '/menu/cart',
        description: 'Back to the order you were building.',
      },
    ],
  };
}
