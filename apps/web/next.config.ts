import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "@document-platform/pdf-browser",
    "@document-platform/tool-registry",
    "@document-platform/ui",
  ],
};

export default nextConfig;
