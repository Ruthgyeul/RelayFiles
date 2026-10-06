import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted on Ubuntu via Docker: emit a minimal standalone server bundle.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
};

export default nextConfig;
