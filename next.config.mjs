/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /*
   * Cross-origin dev requests are allowed from a hosted preview, feature by
   * feature. Next 15.3+ blocks unknown origins by default, so a preview iframe
   * gets a blank page and a "blocked cross-origin request" in the console.
   *
   * The list is configuration, not code: a preview provider that needs its own
   * host adds it to DEV_PREVIEW_ORIGINS (comma separated) instead of editing
   * this file. The default covers the sandbox host the app is developed in;
   * production is unaffected either way, because this setting only applies to
   * `next dev` and a deployed build never calls it.
   */
  allowedDevOrigins: [
    '*.e2b.app',
    ...(process.env.DEV_PREVIEW_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ],

  /**
   * Dish photos can come from the database (menus.items.image_url) rather than
   * from /public, and those are Supabase Storage public URLs. next/image
   * refuses an unlisted remote host at RUNTIME -- the page 500s for that one
   * restaurant and looks fine everywhere else, which is the sort of bug that
   * only shows up after a customer uploads a photo. Local paths under /public
   * need no entry here.
   */
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.supabase.co' }],
  },

  /**
   * Server Actions receive uploaded files in the request body.
   *
   * Next's default cap is 1 MB, which is smaller than a phone photo, so every
   * dish-photo upload from a camera would fail with an opaque "Body exceeded"
   * error before the action ran. 6 MB covers the largest asset this app takes
   * (a 4 MB dish photo, plus multipart overhead) with room to spare.
   *
   * This is NOT the size rule: lib/storage/assets.ts enforces the per-kind
   * limit and the bucket enforces 4 MB again. This number only decides when
   * the request is rejected at the door.
   */
  experimental: {
    serverActions: { bodySizeLimit: '6mb' },
    /*
     * edge-tts-universal uses isomorphic-ws which wraps the `ws` package.
     * These are Node.js packages that must not be bundled into the server
     * bundle — Next.js should load them from node_modules at runtime.
     */
    serverComponentsExternalPackages: ['edge-tts-universal', 'isomorphic-ws', 'ws'],
  },

  /**
   * Security headers. These used to live in netlify.toml, which this project
   * has never deployed from -- Vercel was reading nothing, so every response
   * went out without them. Declared here they apply to the platform that
   * actually serves the app.
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
