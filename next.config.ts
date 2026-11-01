import type { NextConfig } from "next";

/**
 * Sent with every page and API response. No page is meant to be framed (clickjacking on
 * delete / share actions), and share-link URLs must not leak to other sites as a Referer.
 * Content-Security-Policy (with frame-ancestors) and HSTS come from src/proxy.ts, which builds
 * a nonce per request.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // Self-hosted on Ubuntu via Docker: emit a minimal standalone server bundle.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  experimental: {
    // Enables forbidden() / unauthorized() and their 403 / 401 pages.
    authInterrupts: true,
  },
  headers: async () => [
    { source: "/:path*", headers: SECURITY_HEADERS },
    // The share-target service worker (public/sw.js): browsers check it for updates on each visit.
    { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
  ],
};

export default nextConfig;
