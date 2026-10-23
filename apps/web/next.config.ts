import type { NextConfig } from "next";
import { getSiteConfig } from "./lib/site";
import { SECURITY_HEADERS, WORKER_POLICY } from "./lib/security/policy.mjs";

const PROCESSOR_ORIGIN =
  process.env.PROCESSOR_ORIGIN ?? "http://localhost:8000";

// The /api/processor rewrite is a development and preview convenience;
// production is expected to be a same-origin reverse proxy (governance §9.3)
// with its own body-size and timeout settings. The Next proxy defaults (10 MB
// request body, 30 s timeout) silently break the real product: a body over
// 10 MB is truncated and the upload then hangs until the 30 s timeout, and a
// long conversion outlives it. Both are sized from the processor's limits
// (M4D real end-to-end run, docs/reports/M4D-milestone-report.md):
//   body    = processor max input (20 MiB) + headroom, so a slightly oversize
//             file still reaches the processor and gets a clean 413;
//   timeout = runner timeout (120 s) + conversion-queue wait (20 s) + margin.
const PROXY_MAX_BODY = "25mb";
const PROXY_TIMEOUT_MS = 150_000;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    proxyClientMaxBodySize: PROXY_MAX_BODY,
    proxyTimeout: PROXY_TIMEOUT_MS,
  },
  transpilePackages: [
    "@document-platform/pdf-browser",
    "@document-platform/tool-registry",
    "@document-platform/ui",
  ],
  // Defence in depth for ADR-028: when this build is not meant to be indexed,
  // every response says so in the header as well as in the page metadata. The
  // header also covers files that carry no HTML head. One build is one
  // environment, so the decision is made once, here.
  //
  // Security headers (M7C, ADR-034). The page Content-Security-Policy is not
  // here: it names the hash of each page's inline scripts, which exist only
  // after the build, so proxy.ts adds it. What is here is fixed:
  //   * the plain headers on every response, except /api/processor, whose
  //     replies carry the processor's own headers (ADR-033);
  //   * a policy on the script files, because a Web Worker takes its limits
  //     from the response of its own script (production only: the development
  //     server's workers need eval).
  async headers() {
    const rules: Awaited<ReturnType<NonNullable<NextConfig["headers"]>>> = [
      {
        source: "/((?!api/processor(?:/|$)).*)",
        headers: [...SECURITY_HEADERS],
      },
    ];
    if (process.env.NODE_ENV === "production") {
      rules.push({
        source: "/_next/static/:path*",
        headers: [{ key: "Content-Security-Policy", value: WORKER_POLICY }],
      });
      // PDF.js's own files (character maps, standard fonts, WebAssembly
      // decoders) sit under a folder named for the exact version, so a file
      // there never changes. Without this they were sent with max-age=0 and
      // asked for again, and revalidated, on every visit (M7F, ADR-037).
      rules.push({
        source: "/vendor/pdfjs/:version/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      });
    }
    if (!getSiteConfig().indexing)
      rules.push({
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      });
    return rules;
  },
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
