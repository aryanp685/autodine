/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Permit hosted preview origins during local development.
  allowedDevOrigins: ['*.e2b.app', '*.arena.ai'],
};

export default nextConfig;
