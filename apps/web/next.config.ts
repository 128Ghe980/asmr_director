import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop preview accesses the same local development server by IPv4.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
