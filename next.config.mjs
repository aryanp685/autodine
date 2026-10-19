/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the Arena live-preview host to talk to the Next dev server
  // (Next 15.3+ blocks unknown cross-origin dev requests by default).
  allowedDevOrigins: ['*.e2b.app', '*.arena.ai'],
};

export default nextConfig;
