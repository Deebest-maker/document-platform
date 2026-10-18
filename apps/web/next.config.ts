import type { NextConfig } from "next";

const PROCESSOR_ORIGIN =
  process.env.PROCESSOR_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "@document-platform/pdf-browser",
    "@document-platform/tool-registry",
    "@document-platform/ui",
  ],
  async rewrites() {
    return [
      {
        source: "/api/processor/:path*",
        destination: `${PROCESSOR_ORIGIN}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
