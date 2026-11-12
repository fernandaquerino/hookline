// @ts-check

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The E2E suite builds into its own directory (see e2e/playwright.config.ts).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  // The dashboard is served from the same origin as the management API (via this proxy), so the
  // session cookie stays first-party and needs no CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  // Compression would buffer the Server-Sent Events stream.
  compress: false,
};

export default nextConfig;
