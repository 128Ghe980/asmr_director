import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow independent local build output without disturbing a running dev server.
  distDir: process.env.ASMR_NEXT_DIST_DIR || ".next",
  // The desktop preview accesses the same local development server by IPv4.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
