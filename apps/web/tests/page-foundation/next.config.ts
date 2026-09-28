import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: [
    "@document-platform/pdf-browser",
    "@document-platform/ui",
    "@document-platform/tool-registry",
  ],
  turbopack: { root: path.resolve(import.meta.dirname, "../../../..") },
  headers: async () => [
    {
      source: "/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    },
  ],
};
export default config;
