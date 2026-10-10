import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone output is for self-hosting (Docker); Vercel does its own packaging.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
