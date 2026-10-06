import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted on Ubuntu via Docker: emit a minimal standalone server bundle.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  experimental: {
    // Enables forbidden() / unauthorized() and their 403 / 401 pages (docs/plan.md §9).
    authInterrupts: true,
  },
};

export default nextConfig;
