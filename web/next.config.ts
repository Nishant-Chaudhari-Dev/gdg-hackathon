import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run: ship a self-contained server bundle (.next/standalone).
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Old routes keep working. Query strings pass through, so on-call phone alerts that link to
  // /queue?ticket=<id> land on /tickets?ticket=<id> with the ticket panel open.
  async redirects() {
    return [
      { source: "/queue", destination: "/tickets", permanent: false },
      { source: "/outages", destination: "/incidents", permanent: false },
      { source: "/metrics", destination: "/reports", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
